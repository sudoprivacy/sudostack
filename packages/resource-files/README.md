# @sudo/resource-files

Common archive and directory I/O for imported resources. Callers authorize the resource and choose an application-owned staging directory.

- `readResourceArchive(bytes)` validates ZIP paths and entry types, bounds decompression, and returns files with their executable intent.
- `readResourceDirectory(path)` reads regular files and directories without following links.
- `writeResourceFiles(path, files)` validates the full batch before writing and rejects links in the destination.
- `copyResourceDirectory(source, target)` uses those same readers and writer.
- `ownerFileMode(mode)` keeps owner read/write and the source's owner executable bit: `0600` or `0700`. POSIX permissions apply on Unix; Windows uses native filesystem permission behavior.

Limits: 5,000 entries, 50 MiB per file, 200 MiB total, and 32 directory levels. Archive errors occur before destination writes. Staging directories should be published through the caller's atomic publication step.

`RESOURCE_FILES_FORMAT_VERSION` identifies this import representation for caches derived from source archives.

Validation failures use `ResourceFilesError`; callers can map invalid input to their client error response. Filesystem I/O errors keep their native type and code so storage failures remain server failures.
