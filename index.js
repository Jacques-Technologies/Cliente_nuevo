// index.js - Configuración simplificada del bot sin OAuth/Azure

const path = require('path');
const restify = require('restify');
const { BotFrameworkAdapter, MemoryStorage, ConversationState, UserState } = require('botbuilder');

// Importar bot simplificado
const { TeamsBot } = require('./bots/teamsBot');

// Configurar variables de entorno
require('dotenv').config();

// Crear servidor HTTP
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${server.name} listening on ${server.url}`);
    console.log('\n🚀 Bot Nova simplificado iniciado');
    console.log('✅ Sistema de login personalizado activo');
    console.log('❌ OAuth/Azure eliminados');
});

// Crear adaptador del Bot Framework
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword
});

// Manejo de errores del adaptador
adapter.onTurnError = async (context, error) => {
    console.error('Error en bot:', error);
    
    await context.sendActivity('❌ **Error del bot**\n\nOcurrió un error inesperado. Intenta nuevamente.');
    
    // Limpiar estados en caso de error
    try {
        await conversationState.delete(context);
        await userState.delete(context);
    } catch (cleanupError) {
        console.error('Error limpiando estados:', cleanupError);
    }
};

// Crear almacenamiento en memoria (simplificado)
const memoryStorage = new MemoryStorage();

// Crear estados de conversación y usuario
const conversationState = new ConversationState(memoryStorage);
const userState = new UserState(memoryStorage);

// Crear instancia del bot simplificado
const bot = new TeamsBot(conversationState, userState);

// Endpoint principal para mensajes
server.post('/api/messages', async (req, res) => {
    try {
        await adapter.process(req, res, (context) => bot.run(context));
    } catch (error) {
        console.error('Error procesando mensaje:', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Endpoint de salud
server.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        bot: 'Nova Bot Simplificado',
        features: {
            customLogin: true,
            oauth: false,
            azure: false,
            openai: !!process.env.OPENAI_API_KEY
        }
    });
});

// Endpoint de diagnóstico
server.get('/diagnostic', (req, res) => {
    res.json({
        bot: bot.getStats?.() || { status: 'running' },
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
        },
        uptime: Math.round(process.uptime()) + ' segundos',
        environment: {
            hasOpenAI: !!process.env.OPENAI_API_KEY,
            hasBotId: !!process.env.MicrosoftAppId,
            nodeVersion: process.version
        }
    });
});

// Manejo de cierre graceful
process.on('SIGINT', () => {
    console.log('\n🛑 Cerrando bot Nova...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Terminando bot Nova...');
    process.exit(0);
});

console.log('\n📋 Configuración completada:');
console.log('🔐 Login: Tarjeta personalizada con usuario/contraseña');
console.log('🌐 API: https://pruebas.nova.com.mx/ApiRestNova/api/Auth/login');
console.log('🤖 OpenAI: ' + (process.env.OPENAI_API_KEY ? '✅ Configurado' : '❌ No configurado'));
console.log('💾 Storage: Memoria (no persistente)');
console.log('\n🎯 El bot está listo para recibir mensajes');