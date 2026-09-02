# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files


a = Analysis(
    ["sau_entry.py"],
    pathex=["src"],
    binaries=[],
    datas=(
        collect_data_files("utils", includes=["stealth.min.js"])
        + collect_data_files("patchright")
    ),
    hiddenimports=[
        "uploader.douyin_uploader.main",
        "uploader.xiaohongshu_uploader.main",
        "patchright.async_api",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "uploader.baijiahao_uploader",
        "uploader.ks_uploader",
        "uploader.sohu_uploader",
        "uploader.tencent_uploader",
        "uploader.tk_uploader",
        "uploader.toutiao_uploader",
        "uploader.xhs_uploader",
        "uploader.zhihu_uploader",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="reviewflow-sau",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
