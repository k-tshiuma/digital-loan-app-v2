import json

jsonl_path = r'C:\Users\tshik\.gemini\antigravity\brain\671060f9-c97d-4e68-a5ce-86475975a4a7\.system_generated\logs\transcript_full.jsonl'

replacements = []
with open(jsonl_path, 'r', encoding='utf-8') as f:
    for line in f:
        if 'replace_file_content' in line:
            try:
                obj = json.loads(line)
                for call in obj.get('tool_calls', []):
                    if call['name'] == 'replace_file_content':
                        args = call['args']
                        if 'src\\\\components' in repr(args.get('TargetFile', '')):
                            replacements.append(args)
            except Exception as e:
                pass

print(f"Found {len(replacements)} replacements")

for r in replacements:
    path = r['TargetFile']
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        target = r['TargetContent'].replace('\r\n', '\n')
        content = content.replace('\r\n', '\n')
        
        if target in content:
            new_content = content.replace(target, r['ReplacementContent'].replace('\r\n', '\n'))
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f'Reapplied to {path}')
        else:
            print(f'Target not found in {path}')
    except Exception as e:
        print(e)
