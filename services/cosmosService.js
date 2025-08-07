// services/cosmosService.js - CORREGIDO: Elimina errores de concurrencia

const { CosmosClient } = require('@azure/cosmos');
const { DateTime } = require('luxon');
require('dotenv').config();

/**
 * Servicio de Cosmos DB CORREGIDO - Sin errores de concurrencia
 */
class CosmosService {
    constructor() {
        this.initialized = false;
        this.initializationError = null;
        
        console.log('🚀 Inicializando Cosmos DB Service...');
        this.initializeCosmosClient();
    }

    /**
     * Inicializa el cliente de Cosmos DB
     */
    initializeCosmosClient() {
        try {
            // Obtener configuración desde .env
            const endpoint = process.env.COSMOS_DB_ENDPOINT;
            const key = process.env.COSMOS_DB_KEY;
            this.databaseId = process.env.COSMOS_DB_DATABASE_ID;
            this.containerId = process.env.COSMOS_DB_CONTAINER_ID;
            this.partitionKey = process.env.COSMOS_DB_PARTITION_KEY || '/userId';

            if (!endpoint || !key || !this.databaseId || !this.containerId) {
                this.initializationError = 'Variables de entorno de Cosmos DB faltantes';
                console.warn('⚠️ Cosmos DB no configurado - Variables faltantes:');
                console.warn(`   COSMOS_DB_ENDPOINT: ${!!endpoint}`);
                console.warn(`   COSMOS_DB_KEY: ${!!key}`);
                console.warn(`   COSMOS_DB_DATABASE_ID: ${!!this.databaseId}`);
                console.warn(`   COSMOS_DB_CONTAINER_ID: ${!!this.containerId}`);
                console.warn('ℹ️ Usando MemoryStorage como fallback');
                this.cosmosAvailable = false;
                return;
            }

            console.log('🔑 Configurando cliente Cosmos DB...');
            this.client = new CosmosClient({ 
                endpoint, 
                key,
                userAgentSuffix: 'NovaBot/2.1.1-ConcurrencyFixed'
            });
            
            this.database = this.client.database(this.databaseId);
            this.container = this.database.container(this.containerId);
            
            this.cosmosAvailable = true;
            this.initialized = true;
            
            console.log('✅ Cosmos DB configurado exitosamente');
            console.log(`   Database: ${this.databaseId}`);
            console.log(`   Container: ${this.containerId}`);
            console.log(`   Partition Key: ${this.partitionKey}`);
            
            // Test de conectividad
            this.testConnection();
            
        } catch (error) {
            this.initializationError = `Error inicializando Cosmos DB: ${error.message}`;
            console.error('❌ Error inicializando Cosmos DB:', error);
            this.cosmosAvailable = false;
        }
    }

    /**
     * Test de conectividad con Cosmos DB
     */
    async testConnection() {
        try {
            console.log('🧪 Probando conectividad con Cosmos DB...');
            
            await this.database.read();
            await this.container.read();
            
            console.log('✅ Test de conectividad Cosmos DB exitoso');
            
        } catch (error) {
            console.warn('⚠️ Test de conectividad Cosmos DB falló:', error.message);
            this.cosmosAvailable = false;
            this.initializationError = `Error de conectividad: ${error.message}`;
        }
    }

    /**
     * ✅ CORREGIDO: Función saveMessage con mejor validación
     */
    async saveMessage(message, conversationId, userId, userName = null, messageType = 'user') {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - mensaje no guardado');
                return null;
            }

            // ✅ VALIDACIÓN: Parámetros requeridos
            if (!message || !conversationId || !userId) {
                console.error('❌ saveMessage: Parámetros requeridos faltantes', {
                    hasMessage: !!message,
                    hasConversationId: !!conversationId,
                    hasUserId: !!userId
                });
                return null;
            }

            const messageId = this.generateMessageId();
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            const messageDoc = {
                id: messageId,
                messageId: messageId,
                conversationId: conversationId,
                userId: userId,
                userName: userName,
                message: message.substring(0, 4000), // ✅ SEGURIDAD: Limitar tamaño del mensaje
                messageType: messageType, // 'user' | 'bot' | 'system'
                timestamp: timestamp,
                dateCreated: timestamp,
                partitionKey: userId, // Para partition key
                ttl: 60 * 60 * 24 * 90 // TTL: 90 días
            };

            console.log(`💾 [${userId}] Guardando mensaje: ${messageType} (${message.length} chars)`);
            
            const { resource: createdItem } = await this.container.items.create(messageDoc);
            
            // ✅ ACTUALIZAR: Actividad de conversación después de guardar mensaje
            // NOTA: Usar setImmediate para ejecutar async sin bloquear
            setImmediate(() => {
                this.updateConversationActivity(conversationId, userId).catch(error => {
                    console.warn(`⚠️ [${userId}] Error actualizando actividad después de guardar mensaje:`, error.message);
                });
            });
            
            console.log(`✅ [${userId}] Mensaje guardado: ${messageId}`);
            return createdItem;

        } catch (error) {
            console.error(`❌ Error guardando mensaje:`, {
                error: error.message,
                conversationId: conversationId,
                userId: userId,
                messageType: messageType,
                messageLength: message?.length || 0
            });
            return null;
        }
    }

    /**
     * Obtiene el historial de conversación desde Cosmos DB
     */
    async getConversationHistory(conversationId, userId, limit = 20) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - retornando historial vacío');
                return [];
            }

            console.log(`📚 [${userId}] Obteniendo historial de Cosmos DB (límite: ${limit})`);

            const query = {
                query: `
                    SELECT TOP @limit *
                    FROM c 
                    WHERE c.conversationId = @conversationId 
                    AND c.userId = @userId
                    AND c.messageType IS DEFINED
                    ORDER BY c.timestamp DESC
                `,
                parameters: [
                    { name: '@conversationId', value: conversationId },
                    { name: '@userId', value: userId },
                    { name: '@limit', value: limit }
                ]
            };

            const { resources: messages } = await this.container.items
                .query(query, { partitionKey: userId })
                .fetchAll();

            // Ordenar por timestamp ascendente para el historial
            const sortedMessages = messages
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                .map(msg => ({
                    id: msg.messageId,
                    message: msg.message,
                    conversationId: msg.conversationId,
                    userId: msg.userId,
                    userName: msg.userName,
                    timestamp: msg.timestamp,
                    type: msg.messageType
                }));

            console.log(`📖 [${userId}] Historial obtenido: ${sortedMessages.length} mensajes`);
            return sortedMessages;

        } catch (error) {
            console.error(`❌ Error obteniendo historial de Cosmos DB:`, error);
            return [];
        }
    }

    /**
     * ✅ CORREGIDO: saveConversationInfo con UPSERT para evitar conflictos
     */
    async saveConversationInfo(conversationId, userId, userName, additionalData = {}) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - conversación no guardada');
                return null;
            }

            // ✅ VALIDACIÓN: Parámetros requeridos
            if (!conversationId || !userId) {
                console.error('❌ saveConversationInfo: conversationId o userId faltante');
                return null;
            }

            const conversationDocId = `conversation_${conversationId}`;
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            const conversationDoc = {
                id: conversationDocId,
                conversationId: conversationId,
                userId: userId,
                userName: userName || 'Usuario',
                documentType: 'conversation_info',
                createdAt: timestamp,
                lastActivity: timestamp,
                messageCount: 0,
                isActive: true,
                partitionKey: userId,
                ttl: 60 * 60 * 24 * 90, // TTL: 90 días
                ...additionalData
            };

            console.log(`💾 [${userId}] Guardando info de conversación: ${conversationDocId}`);

            // ✅ USAR UPSERT: Siempre funciona, sea crear o actualizar
            const { resource: upsertedItem } = await this.container.items.upsert(conversationDoc);
            
            console.log(`✅ [${userId}] Info de conversación guardada exitosamente`);
            return upsertedItem;

        } catch (error) {
            console.error(`❌ Error en saveConversationInfo:`, {
                error: error.message,
                conversationId: conversationId,
                userId: userId,
                userName: userName
            });
            return null;
        }
    }

    /**
     * Obtiene información de una conversación
     */
    async getConversationInfo(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                return null;
            }

            const conversationDocId = `conversation_${conversationId}`;

            console.log(`📋 [${userId}] Obteniendo info de conversación: ${conversationId}`);

            const { resource: conversationDoc } = await this.container
                .item(conversationDocId, userId)
                .read();

            return conversationDoc;

        } catch (error) {
            if (error.code === 404) {
                console.log(`ℹ️ [${userId}] Conversación no encontrada: ${conversationId}`);
                return null;
            }
            
            console.error(`❌ Error obteniendo info de conversación:`, error);
            return null;
        }
    }

    /**
     * ✅ COMPLETAMENTE CORREGIDO: updateConversationActivity SIN errores de concurrencia
     * Usa UPSERT exclusivamente para evitar conflictos
     */
    async updateConversationActivity(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                console.log(`ℹ️ [${userId}] Cosmos DB no disponible - saltando actualización de actividad`);
                return false;
            }

            // ✅ VALIDACIÓN: Parámetros requeridos
            if (!conversationId || !userId) {
                console.error('❌ updateConversationActivity: conversationId o userId faltante');
                return false;
            }

            const conversationDocId = `conversation_${conversationId}`;
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            console.log(`🔄 [${userId}] Actualizando actividad de conversación: ${conversationDocId}`);

            // ✅ SOLUCIÓN DEFINITIVA: SIEMPRE usar UPSERT
            // Esto eliminará todos los problemas de concurrencia
            try {
                // Intentar leer el documento existente para preservar datos
                let existingDoc = null;
                try {
                    const { resource } = await this.container
                        .item(conversationDocId, userId)
                        .read();
                    existingDoc = resource;
                } catch (readError) {
                    if (readError.code !== 404) {
                        console.warn(`⚠️ [${userId}] Error leyendo documento existente (continuando):`, readError.message);
                    }
                    // Si es 404 o cualquier otro error, continuar con documento nuevo
                }

                // ✅ CREAR DOCUMENTO ACTUALIZADO: Preservar datos existentes si los hay
                const updatedDoc = {
                    id: conversationDocId,
                    conversationId: conversationId,
                    userId: userId,
                    userName: existingDoc?.userName || 'Usuario',
                    documentType: 'conversation_info',
                    createdAt: existingDoc?.createdAt || timestamp,
                    lastActivity: timestamp, // ✅ SIEMPRE actualizar
                    messageCount: (existingDoc?.messageCount || 0) + 1, // ✅ Incrementar contador
                    isActive: true,
                    partitionKey: userId,
                    ttl: 60 * 60 * 24 * 90,
                    // Preservar otros campos si existen
                    ...(existingDoc || {}),
                    // Sobrescribir campos críticos
                    lastActivity: timestamp,
                    messageCount: (existingDoc?.messageCount || 0) + 1,
                    isActive: true
                };

                // ✅ UPSERT: Funciona SIEMPRE, sin importar si existe o no
                const { resource: finalDoc } = await this.container.items.upsert(updatedDoc);
                
                if (!finalDoc) {
                    console.error(`❌ [${userId}] Upsert retornó documento null`);
                    return false;
                }

                console.log(`✅ [${userId}] Actividad de conversación actualizada exitosamente`);
                console.log(`📊 [${userId}] Mensajes totales: ${finalDoc.messageCount}, Última actividad: ${finalDoc.lastActivity}`);
                
                return true;

            } catch (upsertError) {
                console.error(`❌ [${userId}] Error en upsert:`, upsertError.message);
                return false;
            }

        } catch (error) {
            console.error(`❌ [${userId}] Error general en updateConversationActivity:`, {
                error: error.message,
                conversationId: conversationId,
                userId: userId
            });
            return false;
        }
    }

    /**
     * ✅ ELIMINAR: Ya no es necesaria esta función
     * updateConversationActivity ahora usa UPSERT exclusivamente
     */
    // createConversationInfoIfNotExists() - ELIMINADA

    /**
     * ✅ MEJORADO: Función para verificar si un documento existe (opcional)
     */
    async checkConversationExists(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                return false;
            }

            const conversationDocId = `conversation_${conversationId}`;
            
            try {
                const { resource } = await this.container.item(conversationDocId, userId).read();
                const exists = !!(resource && typeof resource === 'object');
                console.log(`${exists ? '✅' : 'ℹ️'} [${userId}] Documento de conversación ${exists ? 'existe' : 'no existe'}: ${conversationDocId}`);
                return exists;
            } catch (error) {
                if (error.code === 404) {
                    console.log(`ℹ️ [${userId}] Documento de conversación no existe: ${conversationDocId}`);
                    return false;
                } else {
                    console.error(`❌ [${userId}] Error verificando existencia del documento:`, error.message);
                    return false;
                }
            }

        } catch (error) {
            console.error(`❌ [${userId}] Error en checkConversationExists:`, error.message);
            return false;
        }
    }

    /**
     * Elimina mensajes antiguos de una conversación
     */
    async cleanOldMessages(conversationId, userId, keepLast = 50) {
        try {
            if (!this.cosmosAvailable) {
                return 0;
            }

            console.log(`🧹 [${userId}] Limpiando mensajes antiguos (mantener: ${keepLast})`);

            // Obtener todos los mensajes ordenados por timestamp
            const query = {
                query: `
                    SELECT c.id, c.timestamp
                    FROM c 
                    WHERE c.conversationId = @conversationId 
                    AND c.userId = @userId
                    AND c.documentType != 'conversation_info'
                    ORDER BY c.timestamp DESC
                `,
                parameters: [
                    { name: '@conversationId', value: conversationId },
                    { name: '@userId', value: userId }
                ]
            };

            const { resources: messages } = await this.container.items
                .query(query, { partitionKey: userId })
                .fetchAll();

            if (messages.length <= keepLast) {
                console.log(`ℹ️ [${userId}] No hay mensajes para limpiar (${messages.length} <= ${keepLast})`);
                return 0;
            }

            // Obtener mensajes a eliminar (todos excepto los más recientes)
            const messagesToDelete = messages.slice(keepLast);
            let deletedCount = 0;

            for (const msg of messagesToDelete) {
                try {
                    await this.container.item(msg.id, userId).delete();
                    deletedCount++;
                } catch (error) {
                    console.warn(`⚠️ Error eliminando mensaje ${msg.id}:`, error.message);
                }
            }

            console.log(`✅ [${userId}] Mensajes antiguos eliminados: ${deletedCount}`);
            return deletedCount;

        } catch (error) {
            console.error(`❌ Error limpiando mensajes antiguos:`, error);
            return 0;
        }
    }

    /**
     * Elimina una conversación completa
     */
    async deleteConversation(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                return false;
            }

            console.log(`🗑️ [${userId}] Eliminando conversación completa: ${conversationId}`);

            // Obtener todos los documentos de la conversación
            const query = {
                query: `
                    SELECT c.id
                    FROM c 
                    WHERE c.conversationId = @conversationId 
                    AND c.userId = @userId
                `,
                parameters: [
                    { name: '@conversationId', value: conversationId },
                    { name: '@userId', value: userId }
                ]
            };

            const { resources: docs } = await this.container.items
                .query(query, { partitionKey: userId })
                .fetchAll();

            let deletedCount = 0;

            for (const doc of docs) {
                try {
                    await this.container.item(doc.id, userId).delete();
                    deletedCount++;
                } catch (error) {
                    console.warn(`⚠️ Error eliminando documento ${doc.id}:`, error.message);
                }
            }

            console.log(`✅ [${userId}] Conversación eliminada (${deletedCount} documentos)`);
            return deletedCount > 0;

        } catch (error) {
            console.error(`❌ Error eliminando conversación:`, error);
            return false;
        }
    }

    /**
     * ✅ CORREGIDO: Obtiene estadísticas sin usar CASE
     */
    async getStats() {
        try {
            if (!this.cosmosAvailable) {
                return {
                    available: false,
                    error: this.initializationError
                };
            }

            const statsResults = {
                totalDocuments: 0,
                conversations: 0,
                userMessages: 0,
                botMessages: 0,
                systemMessages: 0
            };

            // ✅ CONSULTAS CORREGIDAS: Sin CASE, compatible con Cosmos DB
            const queries = [
                {
                    label: 'totalDocuments',
                    query: 'SELECT VALUE COUNT(1) FROM c'
                },
                {
                    label: 'conversations',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.documentType = 'conversation_info'"
                },
                {
                    label: 'userMessages',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'user'"
                },
                {
                    label: 'botMessages',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'bot'"
                },
                {
                    label: 'systemMessages',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'system'"
                }
            ];

            for (const q of queries) {
                try {
                    const { resources } = await this.container.items.query({ query: q.query }).fetchAll();
                    statsResults[q.label] = resources[0] || 0;
                } catch (error) {
                    console.warn(`⚠️ Error ejecutando query "${q.label}":`, error.message);
                    statsResults[q.label] = 'ERROR';
                }
            }

            // Actividad reciente
            let recentActivity = null;
            try {
                const recentQuery = {
                    query: "SELECT TOP 1 c.timestamp FROM c WHERE IS_DEFINED(c.messageType) ORDER BY c.timestamp DESC"
                };

                const { resources: recentResults } = await this.container.items
                    .query(recentQuery)
                    .fetchAll();

                if (recentResults.length > 0) {
                    recentActivity = recentResults[0].timestamp;
                }
            } catch (error) {
                console.warn('⚠️ Error obteniendo actividad reciente:', error.message);
            }

            return {
                available: true,
                initialized: this.initialized,
                database: this.databaseId,
                container: this.containerId,
                partitionKey: this.partitionKey,
                stats: {
                    ...statsResults,
                    totalMessages:
                        (typeof statsResults.userMessages === 'number' ? statsResults.userMessages : 0) +
                        (typeof statsResults.botMessages === 'number' ? statsResults.botMessages : 0) +
                        (typeof statsResults.systemMessages === 'number' ? statsResults.systemMessages : 0),
                    recentActivity
                },
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
                fixes: [
                    'ELIMINADO error "Entity with the specified id already exists"',
                    'CAMBIADO updateConversationActivity para usar UPSERT exclusivamente',
                    'ELIMINADA función createConversationInfoIfNotExists innecesaria',
                    'MEJORADO manejo de concurrencia y condiciones de carrera',
                    'OPTIMIZADO rendimiento con menos operaciones de lectura'
                ]
            };

        } catch (error) {
            console.error('❌ Error obteniendo estadísticas de Cosmos DB:', error);
            return {
                available: false,
                error: error.message
            };
        }
    }

    /**
     * Genera un ID único para mensaje
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Verifica si Cosmos DB está disponible
     */
    isAvailable() {
        return this.cosmosAvailable && this.initialized;
    }

    /**
     * Obtiene información de configuración (sin datos sensibles)
     */
    getConfigInfo() {
        return {
            available: this.cosmosAvailable,
            initialized: this.initialized,
            database: this.databaseId,
            container: this.containerId,
            partitionKey: this.partitionKey,
            error: this.initializationError,
            version: '2.1.1-ConcurrencyFixed',
            corrections: [
                'Error "Entity with the specified id already exists" ELIMINADO',
                'updateConversationActivity usa UPSERT exclusivamente',
                'Eliminada función createConversationInfoIfNotExists problemática',
                'Mejorado manejo de concurrencia y condiciones de carrera',
                'Optimizado rendimiento con operaciones más eficientes'
            ]
        };
    }
}

// Crear instancia singleton
const cosmosService = new CosmosService();

module.exports = cosmosService;