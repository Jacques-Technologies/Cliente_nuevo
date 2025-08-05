// services/cosmosService.js - Servicio de Cosmos DB para persistencia

const { CosmosClient } = require('@azure/cosmos');
const { DateTime } = require('luxon');
require('dotenv').config();

/**
 * Servicio de Cosmos DB para gestionar persistencia de conversaciones y mensajes
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
                userAgentSuffix: 'NovaBot/2.0.0'
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
     * Guarda un mensaje en Cosmos DB
     */
    async saveMessage(message, conversationId, userId, userName = null, messageType = 'user') {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - mensaje no guardado');
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
                message: message,
                messageType: messageType, // 'user' | 'bot' | 'system'
                timestamp: timestamp,
                dateCreated: timestamp,
                partitionKey: userId, // Para partition key
                ttl: 60 * 60 * 24 * 90 // TTL: 90 días
            };

            console.log(`💾 [${userId}] Guardando mensaje en Cosmos DB...`);
            
            const { resource: createdItem } = await this.container.items.create(messageDoc);
            
            console.log(`✅ [${userId}] Mensaje guardado: ${messageId}`);
            return createdItem;

        } catch (error) {
            console.error(`❌ Error guardando mensaje en Cosmos DB:`, error);
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
     * Crea o actualiza información de conversación
     */
    async saveConversationInfo(conversationId, userId, userName, additionalData = {}) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - conversación no guardada');
                return null;
            }

            const conversationDocId = `conversation_${conversationId}`;
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            const conversationDoc = {
                id: conversationDocId,
                conversationId: conversationId,
                userId: userId,
                userName: userName,
                documentType: 'conversation_info',
                createdAt: timestamp,
                lastActivity: timestamp,
                messageCount: 0,
                isActive: true,
                partitionKey: userId,
                ttl: 60 * 60 * 24 * 90, // TTL: 90 días
                ...additionalData
            };

            console.log(`💾 [${userId}] Guardando info de conversación en Cosmos DB...`);

            // Usar upsert para crear o actualizar
            const { resource: upsertedItem } = await this.container.items.upsert(conversationDoc);
            
            console.log(`✅ [${userId}] Info de conversación guardada: ${conversationId}`);
            return upsertedItem;

        } catch (error) {
            console.error(`❌ Error guardando info de conversación en Cosmos DB:`, error);
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
     * Actualiza la última actividad de una conversación
     */
    async updateConversationActivity(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                return false;
            }

            const conversationDocId = `conversation_${conversationId}`;
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            // Obtener documento actual
            let conversationDoc;
            try {
                const { resource } = await this.container
                    .item(conversationDocId, userId)
                    .read();
                conversationDoc = resource;
            } catch (error) {
                if (error.code === 404) {
                    // Crear nuevo documento si no existe
                    return await this.saveConversationInfo(conversationId, userId, 'Usuario');
                }
                throw error;
            }

            // Actualizar campos
            conversationDoc.lastActivity = timestamp;
            conversationDoc.messageCount = (conversationDoc.messageCount || 0) + 1;

            await this.container.items.upsert(conversationDoc);
            
            return true;

        } catch (error) {
            console.error(`❌ Error actualizando actividad de conversación:`, error);
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
     * Obtiene estadísticas de Cosmos DB
     */
    async getStats() {
        try {
            if (!this.cosmosAvailable) {
                return {
                    available: false,
                    error: this.initializationError
                };
            }

            // Consulta para obtener estadísticas básicas
            const statsQuery = {
                query: `
                    SELECT 
                        COUNT(1) as totalDocuments,
                        COUNT(CASE WHEN c.documentType = 'conversation_info' THEN 1 END) as conversations,
                        COUNT(CASE WHEN c.messageType = 'user' THEN 1 END) as userMessages,
                        COUNT(CASE WHEN c.messageType = 'bot' THEN 1 END) as botMessages
                    FROM c
                `
            };

            const { resources: stats } = await this.container.items
                .query(statsQuery)
                .fetchAll();

            return {
                available: true,
                initialized: this.initialized,
                database: this.databaseId,
                container: this.containerId,
                partitionKey: this.partitionKey,
                stats: stats[0] || {},
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO()
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
            error: this.initializationError
        };
    }
}

// Crear instancia singleton
const cosmosService = new CosmosService();

module.exports = cosmosService;