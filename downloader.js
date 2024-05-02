const http = require('http');
const https = require('https');
const fs = require('fs');
const { Readable } = require('stream');

// Function to download a file from a URL with support for following redirects
function downloadFile(url, cookie, destinationPath) {
    return new Promise((resolve, reject) => {
        // Parse URL
        const parsedUrl = new URL(url);

        // HTTP(S) module based on URL protocol
        const httpModule = parsedUrl.protocol === 'https:' ? https : http;

        // HTTP request options
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            // headers: {
            //     Cookie: cookie
            // }
        };

        // Send HTTP request
        const request = httpModule.get(options, response => {
            // Handle redirection
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                console.log("redirected to : ", response.headers.location);
                if (response.headers.location) {
                    downloadFile(response.headers.location, cookie, destinationPath)
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

            // Progress bar
            const progressBarLength = 50;
            let progressBar = '';

            // Readable stream for response body
            const readable = new Readable().wrap(response);

            // Pipe response body to file and update progress
            readable.on('data', chunk => {
                downloaded += chunk.length;
                fileStream.write(chunk);

                // Update progress bar
                const percent = Math.round((downloaded / totalSize) * 100);
                const progressLength = Math.round((downloaded / totalSize) * progressBarLength);
                progressBar = `[${'='.repeat(progressLength)}${' '.repeat(progressBarLength - progressLength)}] ${percent}% ${downloaded}/${totalSize}`;

                // Clear the current line and rewrite progress bar
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                // process.stdout.write(url + '\n ' + progressBar);
                process.stdout.write(progressBar);
            });

            // Finish downloading
            readable.on('end', () => {
                fileStream.end();
                process.stdout.write('\n'); // New line after progress bar
                resolve(`File downloaded to: ${destinationPath}`);
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

// Example usage
const url = "https://mmatechnical.com/Download/Download-Test-File/(MMA)-1GB.zip";
const cookie = 'your_cookie_here';
const destinationPath = './downloadedFile.zip';

downloadFile(url, cookie, destinationPath)
    .then(message => console.log(message))
    .catch(error => console.error(error));
