import { WIFI_SECURITIES, WIFI_SECURITY_LABELS } from '@/domain/payload/wifi';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import type { FieldsProps } from './props';

/**
 * A network a phone can join by looking at a piece of paper.
 *
 * The sentence beside the password is not a warning bolted on: a code that
 * carries a password carries it in the clear, and SECURITY.md says the screen
 * has to say so where the password is typed, not in a policy nobody opens.
 */
export function WifiForm({ form, onChange, invalid }: FieldsProps<'wifi'>) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Network name</span>
        <Input
          aria-label="Network name"
          aria-invalid={invalid === 'ssid'}
          placeholder="Office-5G"
          value={form.ssid}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange({ ...form, ssid: event.target.value })}
        />
      </label>

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Password</span>
          <Input
            aria-label="Password"
            aria-invalid={invalid === 'password'}
            value={form.password}
            spellCheck={false}
            autoComplete="off"
            disabled={form.security === 'nopass'}
            onChange={(event) => onChange({ ...form, password: event.target.value })}
          />
        </label>
        <p className="text-caption text-fg-secondary">
          {form.security === 'nopass'
            ? 'An open network has no password; the code will not carry one.'
            : 'Saved codes keep this password in the clear on this machine.'}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Security</span>
        <Select
          aria-label="Security"
          aria-invalid={invalid === 'security'}
          value={form.security}
          onChange={(event) =>
            onChange({ ...form, security: event.target.value as typeof form.security })
          }
        >
          {WIFI_SECURITIES.map((security) => (
            <option key={security} value={security}>
              {WIFI_SECURITY_LABELS[security]}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex items-center gap-2">
        <Checkbox
          label="Hidden network"
          checked={form.hidden}
          onChange={(hidden) => onChange({ ...form, hidden })}
        />
        <span className="text-body text-fg">Hidden network</span>
      </label>
    </>
  );
}
