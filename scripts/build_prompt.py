#!/usr/bin/env python3
"""question_generation.md را به js/prompt.js تبدیل می‌کند تا برنامه بتواند آن را به هوش مصنوعی بفرستد.

بعد از هر تغییر در question_generation.md اجرا کنید:  python3 scripts/build_prompt.py
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
md = (root / "question_generation.md").read_text(encoding="utf-8")
out = (
    "// این فایل خودکار از question_generation.md ساخته می‌شود؛ مستقیم ویرایشش نکنید.\n"
    "// برای به‌روزرسانی: python3 scripts/build_prompt.py\n"
    f"const GENERATION_PROMPT = {json.dumps(md, ensure_ascii=False)};\n"
)
(root / "js" / "prompt.js").write_text(out, encoding="utf-8")
print("js/prompt.js updated")
