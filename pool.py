import threading
import queue
import time
from urllib.request import urlopen, Request
import os

class DownloadPool(threading.Thread):
    def __init__(self, max_threads):
        super().__init__()
        self.max_threads = max_threads
        self.active_downloads = 0
        self.task_queue = queue.Queue()
        self.progress_info = {}  # Dictionary to store download progress information

    def enqueue_download(self, url, destination_path, file_name):
        self.task_queue.put((url, destination_path, file_name))

    def get_download_progress(self, file_name):
        return self.progress_info.get(file_name)

    def run(self):
        while True:
            if self.active_downloads < self.max_threads and not self.task_queue.empty():
                url, destination_path, file_name = self.task_queue.get()
                download_thread = DownloadThread(url, destination_path, file_name, self)
                download_thread.start()
                self.active_downloads += 1
            time.sleep(0.1)  # Sleep to avoid busy waiting

class DownloadThread(threading.Thread):
    def __init__(self, url, destination_path, file_name, pool):
        super().__init__()
        self.url = url
        self.destination_path = destination_path
        self.file_name = file_name
        self.pool = pool

    def run(self):
        try:
            req = Request(self.url, headers={'User-Agent': 'Mozilla/5.0'})
            with urlopen(req) as response, open(os.path.join(self.destination_path, self.file_name), 'wb') as out_file:
                total_size = int(response.headers.get('content-length', 0))
                downloaded = 0
                while True:
                    chunk = response.read(1024)
                    if not chunk:
                        break
                    out_file.write(chunk)
                    downloaded += len(chunk)
                    percent = downloaded * 100 / total_size
                    self.pool.progress_info[self.file_name] = f'Downloading {self.file_name}: {percent:.2f}%'
            self.pool.progress_info[self.file_name] = f'{self.file_name} downloaded successfully'
        except Exception as e:
            self.pool.progress_info[self.file_name] = f'Error downloading {self.file_name}: {e}'
        finally:
            self.pool.active_downloads -= 1

# Example usage
if __name__ == "__main__":
    download_pool = DownloadPool(max_threads=2)

    tasks = [
        {'url': 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', 'destination_path': './', 'file_name': 'file1.zip'},
        {'url': 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', 'destination_path': './', 'file_name': 'file2.zip'},
        {'url': 'http://speedtest.ftp.otenet.gr/files/test100Mb.db', 'destination_path': './', 'file_name': 'file3.zip'},
    ]

    for task in tasks:
        download_pool.enqueue_download(**task)

    download_pool.start()

    # Example code to interact with the user
    while True:
        user_input = input("Enter 'progress' to check download progress or 'exit' to quit: ")
        if user_input.lower() == 'progress':
            file_name = input("Enter the file name to check progress: ")
            progress = download_pool.get_download_progress(file_name)
            if progress is not None:
                print(progress)
            else:
                print(f"No progress information available for {file_name}")
        elif user_input.lower() == 'exit':
            exit()
