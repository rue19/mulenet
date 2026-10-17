// SPDX-License-Identifier: Apache-2.0
import { XrayForm } from '@/components/XrayForm';

// Rendered per request, so the header shows the running network and deployment rather than the build's defaults.
export const dynamic = 'force-dynamic';

export default function Xray() {
  return (
    <div className="stack">
      <h1>Privacy X-ray</h1>
      <p className="lede">
        Paste an account number or UPI address that has been flagged. The X-ray searches every public transaction and every on-chain
        state the contract has ever had, as text, hex, base64 and hashes. The expected answer is 0. As a control, paste the contract
        address or an institution leaf from a governance proposal: those are public and will be found.
      </p>
      <XrayForm />
    </div>
  );
}
