import json
from pathlib import Path
cases = []
def add(command, args, stdin, stdout='', error=False):
    cases.append(dict(command=command, args=args, stdin=stdin, stdout=stdout, error=error))
for command in ('head', 'tail', 'sort', 'uniq'):
    add(command, [], '', '')
    add(command, [], '\n', '\n')
    add(command, ['-'], 'a\nb', 'a\nb' if command in ('head','tail','uniq') else 'a\nb\n')
    add(command, ['--', '-'], 'a\nb\n', 'a\nb\n')
    add(command, ['--unknown'], 'a\n', error=True)
for command in ('head', 'tail'):
    for args in (['-n','0'], ['-n0'], ['-0'], ['--lines=0']):
        add(command,args,'a\nb\n','')
    for args in (['-n'], ['-n','2junk'], ['-n','1.5'], ['-n','-1'], ['-n','9007199254740992']):
        add(command,args,'a\nb\n',error=True)
    add(command,['-n','1'],'a\nb','a\n' if command=='head' else 'b')
    add(command,['-n','8'],'a\nb','a\nb')
    add(command,['-n','1'],'猫\r\n犬\n','猫\r\n' if command=='head' else '犬\n')
    twelve = ''.join(f'{index}\n' for index in range(12))
    add(command, [], twelve, ''.join(f'{index}\n' for index in (range(10) if command == 'head' else range(2, 12))))
    add(command, ['--lines', '1'], 'a\nb\n', 'a\n' if command == 'head' else 'b\n')
add('sort', [], 'z\na\na', 'a\na\nz\n')
add('sort', ['-ru'], 'z\na\na', 'z\na\n')
add('sort', ['-n'], '10\n-2\n2.5\ntext\n', '-2\ntext\n2.5\n10\n')
add('sort', ['-n'], '2b\n2a\n', '2a\n2b\n')
add('sort', ['-n'], '0z\n-0z\n0a\n-0a\n', '-0a\n-0z\n0a\n0z\n')
add('sort', ['-nu'], '2b\n2a\n1\n', '1\n2a\n')
add('sort', ['--reverse', '--unique'], 'b\na\nb\n', 'b\na\n')
add('uniq', [], 'a\na\nb\na', 'a\nb\na')
add('uniq', ['-cd'], 'a\na\nb\nb\nc\n', '      2 a\n      2 b\n')
add('uniq', ['-cu'], 'a\na\nb\nc\nc\n', '      1 b\n')
add('uniq', ['-i'], 'A\na\nB\n', 'A\nB\n')
add('uniq', ['--count', '--repeated', '--ignore-case'], 'A\na\nB\n', '      2 A\n')
add('uniq', ['-du'], 'a\na\nb\n', error=True)
add('uniq', ['a','b','c'], '', error=True)
Path('conformance/text-commands/cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2)+'\n')
