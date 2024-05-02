from flask import Flask, request, jsonify
import sqlite3
import os
import shutil
import requests
import time

app = Flask(__name__)
DATABASE = 'downloads.db'
DOWNLOADS_FOLDER = 'downloads'

# Create SQLite database connection
def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

# Create 'downloads' table if not exists
def create_table():
    with get_db() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS downloads (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        url TEXT,
                        filePath TEXT,
                        status TEXT DEFAULT 'pending',
                        requestTimestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        downloadTimestamp TIMESTAMP,
                        expirationTimestamp TIMESTAMP
                    )''')

# Middleware to parse JSON bodies
@app.before_request
def before_request():
    if request.headers['Content-Type'] == 'application/json':
        request.json = request.get_json()

# Create 'downloads' folder if not exists
if not os.path.exists(DOWNLOADS_FOLDER):
    os.makedirs(DOWNLOADS_FOLDER)

# Endpoint to submit a URL for download
@app.route('/download', methods=['POST'])
def download():
    url = request.json.get('url')

    try:
        with get_db() as db:
            cursor = db.execute('SELECT * FROM downloads WHERE url = ?', (url,))
            existing_download = cursor.fetchone()

            if existing_download:
                if existing_download['status'] == 'pending' or existing_download['status'] == 'downloading':
                    return jsonify({'success': True, 'message': 'Download pending'})

                elif existing_download['status'] == 'finished':
                    file_path = existing_download['filePath']
                    if os.path.exists(file_path):
                        return jsonify({'success': True, 'message': 'File exists in filesystem'})
                    else:
                        # Add it as a new request
                        db.execute('INSERT INTO downloads (url, requestTimestamp) VALUES (?, ?)', (url, time.strftime('%Y-%m-%d %H:%M:%S')))
                        db.commit()
                        return jsonify({'success': True, 'message': 'URL saved for download'})

            else:
                # Insert URL into database with requestTimestamp
                db.execute('INSERT INTO downloads (url, requestTimestamp) VALUES (?, ?)', (url, time.strftime('%Y-%m-%d %H:%M:%S')))
                db.commit()
                return jsonify({'success': True, 'message': 'URL saved for download'})

    except Exception as e:
        print('Error saving URL:', str(e))
        return jsonify({'success': False, 'error': 'Failed to save URL'}), 500

# Endpoint to list all downloads
@app.route('/downloads', methods=['GET'])
def list_downloads():
    try:
        with get_db() as db:
            cursor = db.execute('SELECT * FROM downloads')
            rows = cursor.fetchall()

        downloads = []
        for row in rows:
            file_path = row['filePath']
            if os.path.exists(file_path):
                file_available = True
            else:
                file_available = False
            row_dict = dict(row)
            row_dict['fileAvailable'] = file_available
            downloads.append(row_dict)

        return jsonify({'success': True, 'downloads': downloads})

    except Exception as e:
        print('Error fetching downloads:', str(e))
        return jsonify({'success': False, 'error': 'Failed to fetch downloads'}), 500

if __name__ == '__main__':
    create_table()
    app.run(debug=True)
