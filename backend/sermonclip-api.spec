# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for bundling the SermonClip FastAPI backend as a single executable.
"""

from PyInstaller.utils.hooks import collect_data_files

# Collect langdetect profile data
langdetect_datas = collect_data_files("langdetect")

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('assets', 'assets'),
        ('.env.production', '.'),
    ] + langdetect_datas,
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
        # Supabase and submodules
        'supabase',
        'supabase.client',
        'supabase._sync',
        'supabase._async',
        'gotrue',
        'gotrue._sync',
        'gotrue._async',
        'postgrest',
        'postgrest._sync',
        'postgrest._async',
        'storage3',
        'storage3._sync',
        'storage3._async',
        'realtime',
        # HTTP client
        'httpx',
        'httpx._transports',
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
        # Dynamic imports
        'pytubefix',
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
