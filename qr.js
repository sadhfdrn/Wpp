// qr.js - QR Code handling module
const QRCode = require('qrcode');

class QRCodeHandler {
    constructor(sessions) {
        this.sessions = sessions;
    }

    // Handle QR code generation during initialization
    handleQRCode(sessionId) {
        return (base64Qr, asciiQR, attempts, urlCode) => {
            console.log('QR Code generated for session:', sessionId);
            console.log('QR Code attempts:', attempts);

            const session = this.sessions.get(sessionId);
            if (session) {
                QRCode.toDataURL(urlCode, { margin: 1 }, (err, dataUrl) => {
                    if (err) {
                        console.error('Failed to generate QR image:', err);
                        return;
                    }
                    session.qrCode = dataUrl.replace(/^data:image\/png;base64,/, '');
                });
                
                session.qrAttempts = attempts;
                session.qrUrl = urlCode;
                session.status = 'qr_code_ready';
                session.qrCodeExpiry = new Date(Date.now() + 60000); // 1 minute
                this.sessions.set(sessionId, session);
                console.log('QR Code stored for session:', sessionId);
            }
        };
    }

    // Generate new QR code for existing session
    async generateNewQRCode(sessionId) {
        const session = this.sessions.get(sessionId);
        
        if (!session) {
            throw new Error('Session not found');
        }

        if (session.connectionMethod !== 'qr-code') {
            throw new Error('Session is not using QR code method');
        }

        if (!session.client || !session.client.getQR) {
            throw new Error('QR code generation not available');
        }

        const qrData = await session.client.getQR();
        if (!qrData) {
            throw new Error('Failed to generate QR code');
        }

        session.qrCode = qrData;
        session.qrCodeExpiry = new Date(Date.now() + 60000); // 1 minute expiry
        this.sessions.set(sessionId, session);

        return {
            success: true,
            qrCode: qrData,
            message: 'New QR code generated'
        };
    }

    // Check if QR code has expired
    isQRCodeExpired(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.qrCodeExpiry) {
            return false;
        }
        return new Date() > session.qrCodeExpiry;
    }

    // Get QR code status
    getQRCodeStatus(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        return {
            qrCode: session.qrCode,
            qrAttempts: session.qrAttempts,
            qrUrl: session.qrUrl,
            qrCodeExpiry: session.qrCodeExpiry,
            isQRExpired: this.isQRCodeExpired(sessionId)
        };
    }
}

module.exports = QRCodeHandler;