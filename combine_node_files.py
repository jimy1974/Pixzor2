import os

# Output file
output_file = "combined.txt"

# Root directory (where server.js is)
root_dir = "."

# Folders to include for .js and .ejs files
include_folders = ["public", "views"]

# File extensions to include
include_extensions = (".js", ".ejs")

# Folders to skip
skip_folders = ["node_modules"]

# Open the output file
with open(output_file, "w", encoding="utf-8") as outfile:
    # First, include server.js if it exists
    server_file = "server.js"
    if os.path.isfile(server_file):
        with open(server_file, "r", encoding="utf-8") as infile:
            outfile.write(f"===== {server_file} =====\n")
            outfile.write(infile.read())
            outfile.write("\n\n")
    
    # Walk through the specified folders
    for folder in include_folders:
        folder_path = os.path.join(root_dir, folder)
        if not os.path.exists(folder_path):
            continue  # Skip if folder doesn't exist
        for root, dirs, files in os.walk(folder_path):
            # Skip any directories in skip_folders
            dirs[:] = [d for d in dirs if d not in skip_folders]
            for filename in files:
                if filename.endswith(include_extensions):
                    file_path = os.path.join(root, filename)
                    with open(file_path, "r", encoding="utf-8") as infile:
                        # Write relative path as header
                        relative_path = os.path.relpath(file_path, root_dir)
                        outfile.write(f"===== {relative_path} =====\n")
                        outfile.write(infile.read())
                        outfile.write("\n\n")