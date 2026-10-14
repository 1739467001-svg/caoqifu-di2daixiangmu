"""Read only the owned local preview's non-secret archive configuration."""
import ctypes
import json
from ctypes import wintypes

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
ntdll = ctypes.WinDLL('ntdll')
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p]
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
handle = kernel.OpenProcess(0x410, False, 40196)
if not handle:
    raise OSError('Owned preview process is unavailable')

def read(address, length):
    buf = ctypes.create_string_buffer(length)
    read_size = ctypes.c_size_t()
    if not kernel.ReadProcessMemory(handle, address, buf, length, ctypes.byref(read_size)):
        raise OSError('Cannot read preview configuration')
    return buf.raw[:read_size.value]

try:
    info = ctypes.create_string_buffer(48)
    ntdll.NtQueryInformationProcess.argtypes = [wintypes.HANDLE, wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG, ctypes.c_void_p]
    if ntdll.NtQueryInformationProcess(handle, 0, info, 48, None):
        raise OSError('Cannot inspect owned preview')
    peb = int.from_bytes(info.raw[8:16], 'little')
    params = int.from_bytes(read(peb + 0x20, 8), 'little')
    env = int.from_bytes(read(params + 0x80, 8), 'little')
    raw = read(env, 8192).decode('utf-16-le', errors='ignore')
    allowed = {'ARCHIVE_DATA_DIR', 'ARCHIVE_SECURE_COOKIE', 'ARCHIVE_COOKIE_PATH'}
    config = {}
    for line in raw.split('\0'):
        key, sep, value = line.partition('=')
        if sep and key in allowed:
            config[key] = value
    print(json.dumps(config, ensure_ascii=False))
finally:
    kernel.CloseHandle(handle)
