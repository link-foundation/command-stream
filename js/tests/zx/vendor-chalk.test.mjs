import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import chalk, {
  Chalk,
  supportsColor,
  detectColorLevel,
} from '../../src/zx/vendor/chalk.mjs';

describe('vendor/chalk', () => {
  let savedLevel;

  before(() => {
    savedLevel = chalk.level;
    chalk.level = 1;
  });

  after(() => {
    chalk.level = savedLevel;
  });

  test('produces the codes zx relies on', () => {
    assert.strictEqual(chalk.greenBright('x'), '\x1B[92mx\x1B[39m');
    assert.strictEqual(chalk.red('x'), '\x1B[31mx\x1B[39m');
    assert.strictEqual(chalk.yellowBright('x'), '\x1B[93mx\x1B[39m');
    assert.strictEqual(chalk.cyanBright('x'), '\x1B[96mx\x1B[39m');
    assert.strictEqual(
      chalk.bgRed.white(' FAIL '),
      '\x1B[41m\x1B[37m FAIL \x1B[39m\x1B[49m'
    );
    assert.strictEqual(
      chalk.greenBright.bold('❯ '),
      '\x1B[92m\x1B[1m❯ \x1B[22m\x1B[39m'
    );
  });

  test('closes and reopens styles around line breaks', () => {
    assert.strictEqual(chalk.reset('\n> '), '\x1B[0m\x1B[0m\n\x1B[0m> \x1B[0m');
    assert.strictEqual(
      chalk.bold('a\r\nb'),
      '\x1B[1ma\x1B[22m\r\n\x1B[1mb\x1B[22m'
    );
  });

  test('joins multiple arguments with a space', () => {
    assert.strictEqual(chalk.red('a', 'b', 1), '\x1B[31ma b 1\x1B[39m');
    assert.strictEqual(chalk('a', 'b'), 'a b');
    assert.strictEqual(chalk.red(), '');
  });

  test('re-opens the outer style after nested styles close', () => {
    assert.strictEqual(
      chalk.red('a', chalk.blue('b'), 'c'),
      '\x1B[31ma \x1B[34mb\x1B[39m\x1B[31m c\x1B[39m'
    );
    assert.strictEqual(
      chalk.bold(chalk.dim('q')),
      '\x1B[1m\x1B[2mq\x1B[22m\x1B[1m\x1B[22m'
    );
  });

  test('supports modifiers, bright and background colors', () => {
    assert.strictEqual(chalk.gray('g'), chalk.blackBright('g'));
    assert.strictEqual(chalk.grey('g'), '\x1B[90mg\x1B[39m');
    assert.strictEqual(chalk.bgGray('g'), '\x1B[100mg\x1B[49m');
    assert.strictEqual(chalk.bgWhiteBright('w'), '\x1B[107mw\x1B[49m');
    assert.strictEqual(chalk.overline('o'), '\x1B[53mo\x1B[55m');
    assert.strictEqual(
      chalk.underline.italic.strikethrough('u'),
      '\x1B[4m\x1B[3m\x1B[9mu\x1B[29m\x1B[23m\x1B[24m'
    );
  });

  test('downsamples rgb/hex/ansi256 per level', () => {
    const basic = new Chalk({ level: 1 });
    assert.strictEqual(basic.rgb(255, 0, 0)('r'), '\x1B[91mr\x1B[39m');
    assert.strictEqual(basic.hex('#00ff00')('g'), '\x1B[92mg\x1B[39m');
    assert.strictEqual(basic.bgHex('#0000ff')('b'), '\x1B[104mb\x1B[49m');
    assert.strictEqual(basic.ansi256(200)('z'), '\x1B[95mz\x1B[39m');

    const ansi256 = new Chalk({ level: 2 });
    assert.strictEqual(ansi256.rgb(255, 0, 0)('r'), '\x1B[38;5;196mr\x1B[39m');
    assert.strictEqual(ansi256.bgAnsi256(33)('b'), '\x1B[48;5;33mb\x1B[49m');

    const truecolor = new Chalk({ level: 3 });
    assert.strictEqual(
      truecolor.hex('#abc')('h'),
      '\x1B[38;2;170;187;204mh\x1B[39m'
    );
    assert.strictEqual(
      truecolor.bgRgb(1, 2, 3)('x'),
      '\x1B[48;2;1;2;3mx\x1B[49m'
    );
  });

  test('level is read at call time and level 0 returns plain text', () => {
    const instance = new Chalk({ level: 1 });
    const red = instance.red;
    assert.strictEqual(red('x'), '\x1B[31mx\x1B[39m');
    instance.level = 0;
    assert.strictEqual(red('x'), 'x');
    assert.strictEqual(instance.bgRed.white('x'), 'x');
    assert.strictEqual(red.level, 0);
    red.level = 1;
    assert.strictEqual(instance.level, 1);
    assert.strictEqual(chalk.level, 1, 'instances are independent');
  });

  test('visible() only emits text when colors are enabled', () => {
    assert.strictEqual(new Chalk({ level: 1 }).visible('v'), 'v');
    assert.strictEqual(new Chalk({ level: 0 }).visible('v'), '');
    assert.strictEqual(
      new Chalk({ level: 1 }).red.visible('v'),
      '\x1B[31mv\x1B[39m'
    );
  });

  test('validates the level option', () => {
    assert.throws(() => new Chalk({ level: 4 }), /integer from 0 to 3/);
    assert.throws(() => new Chalk({ level: 1.5 }), /integer from 0 to 3/);
  });

  test('exposes supportsColor', () => {
    if (supportsColor) {
      assert.ok(supportsColor.level >= 1 && supportsColor.level <= 3);
      assert.strictEqual(supportsColor.hasBasic, true);
    } else {
      assert.strictEqual(supportsColor, false);
    }
  });

  describe('detectColorLevel', () => {
    const tty = { isTTY: true };
    const pipe = { isTTY: false };
    const detect = (stream, env, argv = []) =>
      detectColorLevel(stream, env, argv);

    test('honours FORCE_COLOR', () => {
      assert.strictEqual(detect(pipe, { FORCE_COLOR: '0' }), 0);
      assert.strictEqual(detect(pipe, { FORCE_COLOR: 'false' }), 0);
      assert.strictEqual(detect(pipe, { FORCE_COLOR: '' }), 1);
      assert.strictEqual(detect(pipe, { FORCE_COLOR: 'true' }), 1);
      assert.ok(detect(pipe, { FORCE_COLOR: '1' }) >= 1);
      assert.ok(detect(pipe, { FORCE_COLOR: '2' }) >= 2);
      assert.strictEqual(detect(pipe, { FORCE_COLOR: '3' }), 3);
      assert.strictEqual(detect(tty, { FORCE_COLOR: '0' }), 0);
    });

    test('honours --color / --no-color flags', () => {
      assert.strictEqual(detect(tty, { TERM: 'xterm' }, ['--no-color']), 0);
      assert.strictEqual(detect(pipe, {}, ['--color']), 1);
      assert.strictEqual(detect(pipe, {}, ['--color=256']), 2);
      assert.strictEqual(detect(pipe, {}, ['--', '--color']), 0);
      assert.strictEqual(detect(pipe, { FORCE_COLOR: '3' }, ['--no-color']), 3);
    });

    test('disables colors for NO_COLOR, pipes and dumb terminals', () => {
      assert.strictEqual(detect(tty, { NO_COLOR: '1' }), 0);
      assert.strictEqual(detect(pipe, { TERM: 'xterm' }), 0);
      if (process.platform !== 'win32') {
        assert.strictEqual(detect(tty, { TERM: 'dumb' }), 0);
      }
    });

    test(
      'inspects the terminal on TTYs',
      {
        skip: process.platform === 'win32',
      },
      () => {
        assert.strictEqual(detect(tty, { TERM: 'xterm' }), 1);
        assert.strictEqual(detect(tty, { TERM: 'xterm-256color' }), 2);
        assert.strictEqual(
          detect(tty, { TERM: 'xterm', COLORTERM: 'truecolor' }),
          3
        );
        assert.strictEqual(detect(tty, { CI: 'true', TRAVIS: '1' }), 1);
      }
    );
  });
});
