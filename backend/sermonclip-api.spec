# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for bundling the SermonClip FastAPI backend as a single executable.
"""

import os
from PyInstaller.utils.hooks import collect_data_files

# Collect langdetect profile data and certifi CA bundle
langdetect_datas = collect_data_files("langdetect")
certifi_datas = collect_data_files("certifi")

# Optional data files
extra_datas = [('assets', 'assets')]
if os.path.exists('.env.production'):
    extra_datas.append(('.env.production', '.'))

# Bundle FFmpeg static binaries if available (downloaded during CI)
ffmpeg_binaries = []
if os.path.exists('ffmpeg-bin/ffmpeg'):
    ffmpeg_binaries.append(('ffmpeg-bin/ffmpeg', '.'))
if os.path.exists('ffmpeg-bin/ffprobe'):
    ffmpeg_binaries.append(('ffmpeg-bin/ffprobe', '.'))

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=ffmpeg_binaries,
    datas=extra_datas + langdetect_datas + certifi_datas,
    hiddenimports=[
        # Uvicorn internals
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        # HTTP tools
        'httptools',
        'httptools.parser',
        'httptools.parser.parser',
        # dotenv
        'dotenv',
        # SQLite / SQLModel
        'sqlmodel',
        'sqlalchemy',
        'sqlalchemy.dialects.sqlite',
        'sqlite3',
        'aiosqlite',
        'database',
        'models',
        # HTTP client + SSL certificates
        'httpx',
        'httpx._transports',
        'certifi',
        # Language detection
        'langdetect',
        # Image processing
        'PIL',
        'PIL.Image',
        # Multipart
        'multipart',
        'multipart.multipart',
        # App routers and services
        'routers',
        'routers.video',
        'routers.transcribe',
        'routers.analyze',
        'routers.process',
        'routers.image',
        'routers.clip',
        'routers.youtube',
        'routers.editor',
        'routers.merge',
        'services',
        'services.ffmpeg_service',
        'services.whisper_mlx_service',
        'services.ollama_service',
        'services.highlight_service',
        'services.youtube_service',
        'services.video_resolver',
        'services.image_service',
        'services.clip_service',
        'services.subtitle_service',
        'services.language_detect',
        # MLX Whisper (Apple Silicon transcription)
        'mlx_whisper',
        'mlx',
        # Dynamic imports
        'pytubefix',
        'yt_dlp',
        # Pydantic v2 + PyInstaller compatibility
        'pydantic',
        'pydantic_settings',
        'pydantic.deprecated.decorator',
        'pydantic._internal._generate_schema',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'numpy.testing',
        'scipy',
        'pytest',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='sermonclip-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
