// Connexion WebSocket : envoi JSON, dispatch des messages par type "t".
export class Net {
    constructor(url, handlers) {
        this.url = url;
        this.h = handlers;
        this.ws = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.ws = ws;
            let opened = false;
            ws.onopen = () => {
                opened = true;
                resolve();
            };
            ws.onerror = () => {
                if (!opened) reject(new Error('serveur de jeu injoignable'));
            };
            ws.onclose = () => this.h.close?.();
            ws.onmessage = (e) => {
                let m;
                try {
                    m = JSON.parse(e.data);
                } catch {
                    return;
                }
                this.h[m.t]?.(m);
            };
        });
    }

    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    close() {
        this.ws?.close();
    }
}
