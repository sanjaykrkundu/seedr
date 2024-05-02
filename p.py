from flask import Flask, request, jsonify
import sqlite3
import os
import shutil
import requests
import time
import threading
from urllib.request import urlopen, Request
import queue

app = Flask(__name__)
DATABASE = 'downloads.db'
DOWNLOADS_FOLDER = 'downloads'

class DownloadPool(threading.Thread):
    def __init__(self, max_threads):
        super().__init__()
        self.max_threads = max_threads
        self.active_downloads = 0
        self.task_queue = queue.Queue()
        self.progress_info = {}  # Dictionary to store download progress information

    def enqueue_download(self, url, file_path):
        self.task_queue.put((url, file_path))

    def get_download_progress(self, file_path):
        return self.progress_info.get(file_path)

    def run(self):
        while True:
            if self.active_downloads < self.max_threads and not self.task_queue.empty():
                url, file_path = self.task_queue.get()
                download_thread = DownloadThread(url, file_path, self)
                download_thread.start()
                self.active_downloads += 1
            time.sleep(0.1)  # Sleep to avoid busy waiting

class DownloadThread(threading.Thread):
    def __init__(self, url, file_path, pool):
        super().__init__()
        self.url = url
        self.file_path = file_path
        self.pool = pool

    def run(self):
        try:
            req = Request(self.url, headers={'User-Agent': 'Mozilla/5.0'})
            with urlopen(req) as response, open(self.file_path, 'wb') as out_file:
                total_size = int(response.headers.get('content-length', 0))
                downloaded = 0
                while True:
                    chunk = response.read(1024)
                    if not chunk:
                        break
                    out_file.write(chunk)
                    downloaded += len(chunk)
                    percent = downloaded * 100 / total_size
                    self.pool.progress_info[self.file_path] = f'Downloading {self.file_path}: {percent:.2f}%'
            self.pool.progress_info[self.file_path] = f'{self.file_path} downloaded successfully'
        except Exception as e:
            self.pool.progress_info[self.file_path] = f'Error downloading {self.file_path}: {e}'
        finally:
            self.pool.active_downloads -= 1

download_pool = DownloadPool(max_threads=5)
download_pool.start()

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

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

# @app.before_request
# def before_request():
#     if request.headers['Content-Type'] == 'application/json':
#         request.json = request.get_json()

if not os.path.exists(DOWNLOADS_FOLDER):
    os.makedirs(DOWNLOADS_FOLDER)

@app.route('/download', methods=['POST'])
def download():
    url = request.json.get('url')
    if url:
        file_name = os.path.basename(url)
        file_path = os.path.join(DOWNLOADS_FOLDER, file_name)
        try:
            with get_db() as db:
                cursor = db.execute('SELECT * FROM downloads WHERE url = ?', (url,))
                existing_download = cursor.fetchone()

                if existing_download:
                    if existing_download['status'] == 'pending' or existing_download['status'] == 'downloading':
                        return jsonify({'success': True, 'message': 'Download pending'})

                    elif existing_download['status'] == 'finished':
                        if os.path.exists(file_path):
                            return jsonify({'success': True, 'message': 'File exists in filesystem'})
                        else:
                            db.execute('UPDATE downloads SET status = ? WHERE url = ?', ('pending', url))
                            db.commit()
                            download_pool.enqueue_download(url, file_path)
                            return jsonify({'success': True, 'message': 'Download resumed'})

                else:
                    db.execute('INSERT INTO downloads (url, filePath) VALUES (?, ?)', (url, file_path))
                    db.commit()
                    download_pool.enqueue_download(url, file_path)
                    return jsonify({'success': True, 'message': 'Download started'})

        except Exception as e:
            print('Error processing download request:', str(e))
            return jsonify({'success': False, 'error': 'Failed to process download request'}), 500
    else:
        return jsonify({'success': False, 'error': 'URL not provided'}), 400

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
            row_dict['progress'] = download_pool.get_download_progress(file_path)
            downloads.append(row_dict)

        return jsonify({'success': True, 'downloads': downloads})

    except Exception as e:
        print('Error fetching downloads:', str(e))
        return jsonify({'success': False, 'error': 'Failed to fetch downloads'}), 500

def cleanup():
    global download_pool
    download_pool.join()  # Wait for the download pool thread to finish
    print("Download pool stopped.")

if __name__ == '__main__':
    create_table()
    app.run(debug=True)

    # Clean up when the application is closed
    cleanup()
