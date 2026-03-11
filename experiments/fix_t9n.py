#!/usr/bin/env python3
"""
Script to fix t9n translation markup by:
1. Replacing <t9n>[RU]...[EN]...</t9n> with just Russian text
2. Replacing t9n('[RU]...[EN]...') with just Russian text string

The patterns to match and replace:
- <t9n>[RU]text_ru[EN]text_en</t9n> -> text_ru
- <t9n> [RU]text_ru[EN]text_en</t9n> -> text_ru  (with leading space)
- t9n('[RU]text_ru[EN]text_en') -> 'text_ru'
- t9n("[RU]text_ru[EN]text_en") -> "text_ru"
"""

import re
import sys

def fix_t9n_tags(content):
    """Replace <t9n>[RU]...[EN]...</t9n> with just the Russian text."""
    # Pattern: <t9n ...> [RU]RU_TEXT[EN]EN_TEXT</t9n> (optional attrs and leading space before [RU])
    pattern = r'<t9n[^>]*>\s*\[RU\](.*?)\[EN\].*?</t9n>'
    return re.sub(pattern, r'\1', content, flags=re.DOTALL)

def fix_t9n_function_calls(content):
    """Replace t9n('[RU]...[EN]...') with just the Russian text in quotes."""
    # Pattern with single quotes: t9n('[RU]RU_TEXT[EN]EN_TEXT')
    pattern_sq = r"t9n\('\[RU\](.*?)\[EN\].*?'\)"
    content = re.sub(pattern_sq, r"'\1'", content, flags=re.DOTALL)
    
    # Pattern with double quotes: t9n("[RU]RU_TEXT[EN]EN_TEXT")
    pattern_dq = r't9n\("\[RU\](.*?)\[EN\].*?"\)'
    content = re.sub(pattern_dq, r'"\1"', content, flags=re.DOTALL)
    
    return content

def process_file(filepath):
    """Process a single file and replace all t9n patterns."""
    with open(filepath, 'r', encoding='utf-8') as f:
        original = f.read()
    
    content = original
    content = fix_t9n_tags(content)
    content = fix_t9n_function_calls(content)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated: {filepath}")
        return True
    else:
        print(f"No changes: {filepath}")
        return False

def main():
    files = [
        'templates/form.html',
        'templates/main.html',
        'templates/object.html',
        'templates/sql.html',
        'templates/forms.html',
        'templates/my/main.html',
        'templates/edit_types.html',
        'templates/upload.html',
        'templates/dir_admin.html',
        'templates/quiz.html',
    ]
    
    changed = 0
    for f in files:
        if process_file(f):
            changed += 1
    
    print(f"\nTotal files changed: {changed}")

if __name__ == '__main__':
    main()
