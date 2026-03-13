import os
import paramiko
import getpass

# --- Server Configuration ---
# Replace these with your server's details.
# It's better to use environment variables or a config file for sensitive data.
HOSTNAME = "1ink.us"
PORT = 22  # Default SFTP/SSH port
USERNAME = "ford442"

# --- Project Configuration ---
# The local directory to upload from.
LOCAL_DIRECTORY = "dist"
# The directory on the server where the files should go (e.g., 'public_html/wasm-game').
REMOTE_DIRECTORY = "test.1ink.us/xm-player"

def upload_directory(sftp_client, local_path, remote_path):
    """
    Recursively uploads a directory and its contents to the remote server.
    """
    print(f"Creating remote directory: {remote_path}")
    try:
        # Create the target directory on the server if it doesn't exist.
        sftp_client.mkdir(remote_path)
    except IOError:
        # Directory already exists, which is fine.
        print(f"Directory {remote_path} already exists.")

    for item in os.listdir(local_path):
        local_item_path = os.path.join(local_path, item)
        remote_item_path = f"{remote_path}/{item}"

        if os.path.isfile(local_item_path):
            print(f"Uploading file: {local_item_path} -> {remote_item_path}")
            sftp_client.put(local_item_path, remote_item_path)
        elif os.path.isdir(local_item_path):
            # If it's a directory, recurse into it.
            upload_directory(sftp_client, local_item_path, remote_item_path)

def build_project():
    """
    Builds the Vite project with the correct base path for the deployment subdirectory.
    VITE_APP_BASE_PATH must match REMOTE_DIRECTORY's last segment (e.g. /xm-player/).
    """
    import subprocess
    base_segment = REMOTE_DIRECTORY.rstrip('/').split('/')[-1]
    base_path = f"/{base_segment}/"
    env = os.environ.copy()
    env["VITE_APP_BASE_PATH"] = base_path
    print(f"Building project with VITE_APP_BASE_PATH={base_path} ...")
    result = subprocess.run(["npm", "run", "build"], env=env, cwd=os.path.dirname(os.path.abspath(__file__)))
    if result.returncode != 0:
        raise RuntimeError("npm run build failed — aborting deploy")
    print("Build complete ✅")

def main():
    """
    Main function to connect to the server and start the upload process.
    """
    password = 'GoogleBez12!' # getpass.getpass(f"Enter password for {USERNAME}@{HOSTNAME}: ")

    build_project()

    transport = None
    sftp = None
    try:
        # Establish the SSH connection
        transport = paramiko.Transport((HOSTNAME, PORT))
        print("Connecting to server...")
        transport.connect(username=USERNAME, password=password)
        print("Connection successful!")

        # Create an SFTP client from the transport
        sftp = paramiko.SFTPClient.from_transport(transport)
        print(f"Starting upload of '{LOCAL_DIRECTORY}' to '{REMOTE_DIRECTORY}'...")

        # Start the recursive upload
        upload_directory(sftp, LOCAL_DIRECTORY, REMOTE_DIRECTORY)

        print("\n✅ Deployment complete!")

    except Exception as e:
        print(f"❌ An error occurred: {e}")
    finally:
        # Ensure the connection is closed
        if sftp:
            sftp.close()
        if transport:
            transport.close()
        print("Connection closed.")

if __name__ == "__main__":
    main()

