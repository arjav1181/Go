'use client';

type Option = { id: string; name: string };

/**
 * Checkbox multi-select for existing tags/folders plus a free-text field to
 * create new ones inline (comma or newline separated).
 *
 * Checkboxes share the same `name`, so FormData.getAll() returns every
 * selection and deselecting simply omits the id.
 */
export function LabelPicker({
  legend,
  options,
  name,
  newFieldName,
  newFieldLabel,
  newFieldPlaceholder,
  defaultSelected = []
}: {
  legend: string;
  options: Option[];
  name: string;
  newFieldName: string;
  newFieldLabel: string;
  newFieldPlaceholder: string;
  defaultSelected?: string[];
}) {
  const selected = new Set(defaultSelected);
  const hasOptions = options.length > 0;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>

      {hasOptions ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <label
              key={option.id}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent)] has-[:checked]:text-white"
            >
              <input
                type="checkbox"
                name={name}
                value={option.id}
                defaultChecked={selected.has(option.id)}
                className="accent-[var(--accent)]"
              />
              {option.name}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">None created yet.</p>
      )}

      <div className="space-y-1">
        <label htmlFor={newFieldName} className="text-xs font-medium text-[var(--muted)]">
          {newFieldLabel}
        </label>
        <input
          id={newFieldName}
          name={newFieldName}
          type="text"
          placeholder={newFieldPlaceholder}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
      </div>
    </fieldset>
  );
}