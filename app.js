const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Create SQLite database connection
const db = new sqlite3.Database('downloads.db');
console.log(`[${getCurrentTimestamp()}] DB created`);

// Create 'downloads' table if not exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT,
        filePath TEXT,
        status TEXT DEFAULT 'pending',
        requestTimestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        downloadTimestamp TIMESTAMP,
        expirationTimestamp TIMESTAMP
    )`);
});

console.log(`[${getCurrentTimestamp()}] Table created`);


// Middleware to parse JSON bodies
app.use(express.json());

// Create 'downloads' folder if not exists
const downloadsFolder = path.join(__dirname, 'downloads');
fs.mkdir(downloadsFolder, { recursive: true })
    .then(() => console.log(`[${getCurrentTimestamp()}] Download folder created`))
    .catch(err => console.error(`[${getCurrentTimestamp()}] Error creating downloads folder:`, err));

// Endpoint to submit a URL for download
app.post('/download', async (req, res) => {
    const { url } = req.body;

    try {
       // Check if URL already exists in the database
        const existingDownload = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM downloads WHERE url = ? ORDER BY requestTimestamp DESC LIMIT 1`, [url], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        let newRequest = false;
        if (existingDownload) {
            if (existingDownload.status === 'pending' || existingDownload.status === 'downloading') {
                // If status is pending or downloading, return response "Download pending"
                res.json({ success: true, message: 'Download pending' });
            } else if (existingDownload.status === 'finished') {
                // If status is finished, check if file exists in the file system
                const filePath = path.join(__dirname, existingDownload.filePath);
                console.log(filePath);
                try {
                    await fs.access(filePath);
                    // If file exists in the file system, return response "File exists in filesystem"
                    res.json({ success: true, message: 'File exists in filesystem' });
                } catch (error) {
                    // If file is not present in the file system, add it as a new request
                    newRequest = true;
                    console.log(`[${getCurrentTimestamp()}] File not exist, adding to new download`);
                }
            }
        } else {
            newRequest = true;
        }
        
        if (newRequest) {
            console.log(`[${getCurrentTimestamp()}] New request : ${url}`);
            // Insert URL into database with requestTimestamp
            db.run(`INSERT INTO downloads (url, requestTimestamp) VALUES (?, ?)`, [url, getCurrentTimestamp()], (err) => {
                if (err) {
                    console.error('Error saving URL:', err);
                    res.status(500).json({ success: false, error: 'Failed to save URL' });
                } else {
                    res.json({ success: true, message: 'URL saved for download' });
                }
            });
        }
    } catch (error) {
        console.error('Error saving URL:', error);
        res.status(500).json({ success: false, error: 'Failed to save URL' });
    }
});


// Endpoint to list all downloads
app.get('/downloads', async (req, res) => {
    try {
        // Read the list of files from the downloads folder
        const files = await fs.readdir(downloadsFolder);

        // Fetch all downloads from the database
        db.all(`SELECT * FROM downloads`, async (err, rows) => {
            if (err) {
                console.error('Error fetching downloads:', err);
                res.status(500).json({ success: false, error: 'Failed to fetch downloads' });
            } else {
                // Iterate through each row and check if the filePath exists in the list of files
                const downloadsWithFileAvailability = rows.map(row => {
                    const fileAvailable = files.includes(row.filePath.split('/').pop());
                    return { ...row, fileAvailable };
                });

                res.json({ success: true, downloads: downloadsWithFileAvailability });
            }
        });
    } catch (error) {
        console.error('Error reading files from downloads folder:', error);
        res.status(500).json({ success: false, error: 'Failed to read files from downloads folder' });
    }
});

// Function to generate timestamp
function getCurrentTimestamp() {
    return new Date().toISOString();
}

// Background task to start downloading files every 2 minutes
cron.schedule('*/1 * * * *', async () => {
    const currentTime = getCurrentTimestamp();

    console.log(`[${currentTime}] Starting download process...`);

    // Fetch pending downloads from the database
    const pendingDownloads = await new Promise((resolve, reject) => {
        db.all(`SELECT * FROM downloads WHERE status IN ('pending')`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    // Loop through each pending or finished download and initiate download
    for (const download of pendingDownloads) {
        const { id, url, status, requestTimestamp } = download;
        if (status === 'pending') {
            try {
                // Update status to 'downloading'
                db.run(`UPDATE downloads SET status = 'downloading' WHERE id = ?`, [id]);

                // Download file from URL
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                const fpath = `downloads/${Date.now()}_${url.split('/').pop()}`;
                const filePath = path.join(__dirname, fpath);

                // Save file to server
                await fs.writeFile(filePath, response.data);

                // Set downloadTimestamp to current time
                const downloadTimestamp = getCurrentTimestamp();

                // Calculate expiration timestamp (10 days from downloadTimestamp)
                const expirationTimestamp = new Date();
                expirationTimestamp.setDate(expirationTimestamp.getDate() + 10);
                const expirationTimestampString = expirationTimestamp.toISOString();

                // Update record in database with file path, status, and timestamps
                db.run(`UPDATE downloads SET filePath = ?, status = 'finished', downloadTimestamp = ?, expirationTimestamp = ? WHERE id = ?`,
                    [fpath, downloadTimestamp, expirationTimestampString, id]);

                console.log(`[${currentTime}] File downloaded successfully from ${url}`);
                console.log(`[${currentTime}] Downloaded file path: ${filePath}`);
            } catch (error) {
                console.error(`[${currentTime}] Error downloading file from ${url}:`, error);
                // Update status to 'pending' if download failed
                db.run(`UPDATE downloads SET status = 'pending' WHERE id = ?`, [id]);
            }
        }
    }
    console.log(`[${currentTime}] Finished download process...`);
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
