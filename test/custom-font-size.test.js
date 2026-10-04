import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  useFontSize,
  applyFontSize,
  FONT_SIZE_PRESETS,
  DEFAULT_FONT_SIZE
} from '../frontend/src/composables/useFontSize.js';

describe('自定义聊天消息字号调节 (Custom Message Font Size)', () => {
  it('预设档位完整且默认字号为 15px', () => {
    assert.equal(DEFAULT_FONT_SIZE, 15);
    assert.ok(Array.isArray(FONT_SIZE_PRESETS));
    assert.equal(FONT_SIZE_PRESETS.length, 5);

    const sizes = FONT_SIZE_PRESETS.map((p) => p.size);
    assert.deepEqual(sizes, [13, 15, 17, 19, 21]);
  });

  it('支持灵活调节字号并做安全范围约束 (12px ~ 26px)', () => {
    const { messageFontSize, setFontSize, resetFontSize } = useFontSize();

    // Set to 17px
    setFontSize(17);
    assert.equal(messageFontSize.value, 17);

    // Below min bound
    setFontSize(8);
    assert.equal(messageFontSize.value, 12);

    // Above max bound
    setFontSize(35);
    assert.equal(messageFontSize.value, 26);

    // Reset to default
    resetFontSize();
    assert.equal(messageFontSize.value, 15);
  });

  it('能正确计算并应用 CSS 变量到 DOM 根节点', () => {
    const mockStyle = {};
    global.document = {
      documentElement: {
        style: {
          setProperty: (k, v) => {
            mockStyle[k] = v;
          }
        }
      }
    };

    applyFontSize(18);
    assert.equal(mockStyle['--chat-font-size'], '18px');
    assert.ok(mockStyle['--chat-line-height']);

    // Clean up
    delete global.document;
  });
});
