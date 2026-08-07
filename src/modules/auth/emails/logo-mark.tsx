import * as React from 'react';

import { LOGO_MARK_PNG_BASE64 } from './assets/logo-mark.base64';

const BRAND_TEAL = '#0f766e';

/**
 * Mirrors safemeds-frontend/components/ui/logo-mark.tsx's pulse-line mark
 * (same shape, same teal rounded-square treatment) so the brand is
 * recognizable across the app and its emails.
 *
 * Renders as a pre-baked PNG (see ./assets/logo-mark.base64.ts), not an
 * inline <svg> — most email clients (Gmail chief among them) strip <svg>
 * markup outright, which used to silently collapse this down to a plain
 * teal square with no mark visible. The `<td>` background color is kept
 * as a belt-and-braces fallback for the rare client that also blocks
 * data: URI images, so the shape stays branded-teal even in that case.
 */
export function LogoMark(): React.ReactElement {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
      <tbody>
        <tr>
          <td
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: BRAND_TEAL,
              textAlign: 'center',
              verticalAlign: 'middle',
            }}
          >
            <img
              src={`data:image/png;base64,${LOGO_MARK_PNG_BASE64}`}
              width={40}
              height={40}
              alt="SafeMeds"
              style={{ display: 'block', borderRadius: 10 }}
            />
          </td>
        </tr>
      </tbody>
    </table>
  );
}
