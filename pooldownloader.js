const http = require('http');
const https = require('https');
const fs = require('fs');
const { Readable } = require('stream');

class DownloadPool {
    constructor(poolSize) {
        this.poolSize = poolSize;
        this.activeDownloads = 0;
        this.taskQueue = [];
        this.progress = {}; // Progress information for each ongoing download
        this.cursorPositions = {}; // Cursor position for each ongoing download
    }

    async enqueueDownload(url, cookie, destinationPath, fileName) {
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ url, cookie, destinationPath, fileName, resolve, reject });
            this.dequeueDownloads();
        });
    }

    async dequeueDownloads() {
        while (this.activeDownloads < this.poolSize && this.taskQueue.length > 0) {
            const { url, cookie, destinationPath, fileName, resolve, reject } = this.taskQueue.shift();
            this.activeDownloads++;
            try {
                await this.downloadFile(url, cookie, destinationPath, fileName);
                resolve(`File downloaded: ${fileName}`);
            } catch (error) {
                reject(error);
            } finally {
                this.activeDownloads--;
                delete this.progress[fileName]; // Remove progress information for completed download
                delete this.cursorPositions[fileName]; // Remove cursor position for completed download
                this.dequeueDownloads();
            }
        }
    }

    async downloadFile(url, cookie, destinationPath, fileName) {
        return new Promise((resolve, reject) => {
            // Parse URL
            const parsedUrl = new URL(url);

            // HTTP(S) module based on URL protocol
            const httpModule = parsedUrl.protocol === 'https:' ? https : http;

            // HTTP request options
            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                headers: {
                    Cookie: cookie
                }
            };

            fileName = destinationPath;

            // Send HTTP request
            const request = httpModule.get(options, response => {
                if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                    if (response.headers.location) {
                        this.downloadFile(response.headers.location, cookie, destinationPath, fileName)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    reject(`Failed to download file. HTTP Status Code: ${response.statusCode}`);
                    return;
                }

                // Create write stream for destination file
                const fileStream = fs.createWriteStream(destinationPath);

                // Progress variables
                let totalSize = parseInt(response.headers['content-length'], 10);
                let downloaded = 0;

                // Readable stream for response body
                const readable = new Readable().wrap(response);

                // Pipe response body to file and update progress
                readable.on('data', chunk => {
                    downloaded += chunk.length;

                    // Update progress information
                    this.progress[fileName] = {
                        downloaded,
                        totalSize
                    };

                    // Update progress bar
                    this.updateProgressBar(fileName);
                });

                // Finish downloading
                readable.on('end', () => {
                    fileStream.end();
                    process.stdout.write('\n'); // New line after download completes
                    resolve();
                });

                // Error handling
                fileStream.on('error', err => {
                    reject(`Error writing to file: ${err}`);
                });

                readable.on('error', err => {
                    reject(`Error reading response: ${err}`);
                });
            });

            // Error handling for HTTP request
            request.on('error', err => {
                reject(`Error downloading file: ${err}`);
            });
        });
    }

    updateProgressBar(fileName) {
        const progressInfo = this.progress[fileName];
        if (!progressInfo) return;

        const { downloaded, totalSize } = progressInfo;
        const percent = Math.round((downloaded / totalSize) * 100);
        const progressLength = Math.round((downloaded / totalSize) * 50);
        const progressBar = `[${'='.repeat(progressLength)}${' '.repeat(50 - progressLength)}] ${percent}% - ${fileName}`;

        if (!this.cursorPositions[fileName]) {
            // Save current cursor position
            this.cursorPositions[fileName] = process.stdout.cursorTo(0);
            process.stdout.write(progressBar);
        } else {
            // Move cursor to saved position and overwrite previous progress bar
            // this.cursorPositions[fileName].write(progressBar);
            console.log(progressBar);
        }
    }
}

// Example usage
const downloadPool = new DownloadPool(5);

const tasks = [
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file1.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file2.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file3.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file4.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file5.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file5.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file6.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file7.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file8.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file9.zip' },
    { url: 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', cookie: 'your_cookie_here', destinationPath: './file10.zip' },
    // Add more tasks as needed
];

tasks.forEach(({ url, cookie, destinationPath }) => {
    downloadPool.enqueueDownload(url, cookie, destinationPath)
        .then(message => console.log(message))
        .catch(error => console.error(error));
});
