import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';

const phoneNumber = `${process.env.PHONE_NUMBER}@c.us`;

const messages = [
    'Recordá tomar la pastilla mi amor ❤️',
    'Hora de la pastilla amor 💕',
    'Pastillita del día mi chiquita preshiosha (yo te amo mas)❣️',
    'No te olvides la pastilla my loveshito 💘'
];

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    // Escaneás esto con el WhatsApp de tu celu
    qrcode.generate(qr, {small: true});
    console.log('Escaneá el QR con tu WhatsApp');
});

client.on('ready', () => {
    console.log('Bot listo!');
    
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    cron.schedule('30 22 * * *', async () => {
        console.log('Cron ejecutándose:', new Date().toLocaleString());
        
        try {
            await client.sendMessage(phoneNumber, randomMessage);
            console.log('Mensaje enviado!');
        } catch (error) {
            console.error('Error:', error);
        }
    });
});

client.initialize();