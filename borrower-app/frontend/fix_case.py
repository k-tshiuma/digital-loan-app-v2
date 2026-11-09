import os, re

dir_path = os.path.join(os.path.dirname(__file__), 'src', 'components')

for root, _, files in os.walk(dir_path):
    for file in files:
        if file.endswith('.tsx'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Replace ' uppercase tracking-wider' and 'uppercase tracking-wider ' from classNames in labels and spans
            # Also replace ' uppercase tracking-widest'
            
            # Find all classNames containing 'uppercase' and 'tracking-wider' or 'tracking-widest'
            # But let's just do a regex replace on specific combinations commonly used for field labels:
            
            new_content = re.sub(r'(\btext-[a-z]+-\d+\s+?)uppercase\s+tracking-wide[rs]t?\b', r'\1', content)
            new_content = re.sub(r'uppercase\s+tracking-wide[rs]t?\s+?', '', new_content)
            
            if new_content != content:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f'Fixed case classes in {file}')
