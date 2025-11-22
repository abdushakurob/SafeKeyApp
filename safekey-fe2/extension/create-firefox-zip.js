import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createFirefoxZip() {
    const output = fs.createWriteStream(path.join(__dirname, 'safekey-firefox.zip'));
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    return new Promise((resolve, reject) => {
        output.on('close', () => {
            console.log('✅ Archive created: ' + archive.pointer() + ' total bytes');
            console.log('📦 File: safekey-firefox.zip');
            resolve();
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        // Add all files from dist directory, maintaining structure
        archive.directory('dist/', false);

        archive.finalize();
    });
}

createFirefoxZip().catch(console.error);
