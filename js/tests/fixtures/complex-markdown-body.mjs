// A single regression payload shared by issue #40 and the competitor corpus.
// The final two spaces on the whitespace line are assembled explicitly so
// editors and formatters cannot trim the data under test.
export const COMPLEX_MARKDOWN_BODY = `## Bug description

Passing Markdown through \`gh issue create --body\` must preserve:

- fenced code blocks:
\`\`\`javascript
const message = \`literal \${value}\`;
console.log("double", 'single', message);
\`\`\`
- shell-looking text: $HOME \${USER} $(whoami) \`date\`
- operators and globs: && || ; | > < * ? [abc] {one,two}
- whitespace: leading,  repeated, and trailing${'  '}
- backslashes and paths: C:\\Program Files\\command-stream\\README.md
- Unicode: snow 雪, rocket 🚀, and café

Nothing above is shell syntax.`;
