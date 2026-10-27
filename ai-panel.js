// AI primary copy-paste flow for Make-Me-Sankey
(function() {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function() {
    // Insert primary panel before the layout grid
    const grid = document.querySelector('.sankey-layout-grid');
    if (!grid) return;

    const panel = document.createElement('div');
    panel.id = 'ai-primary-panel';
    panel.className = 'panel mb-6';
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="panel-title">Describe your flows</div>
          <div class="panel-subtitle">Primary path — AI fills the data, you refine if needed</div>
        </div>
        <button id="toggle-advanced-btn" class="btn btn-ghost text-xs">Advanced editor ▾</button>
      </div>
      <div class="p-4 space-y-4">
        <div>
          <label class="block text-xs font-semibold text-[#9a9484] mb-1">1. Your requirements</label>
          <textarea id="user-requirements" class="w-full h-24 field-input border border-[#e7e3d8] rounded-lg p-3 text-sm" placeholder="e.g. Revenue from iPhone and Mac splits into Direct and Partner channels, then into Gross Margin and Cost of Sales. Use restrained colors."></textarea>
        </div>
        <div class="flex gap-2">
          <button id="generate-prompt-btn" class="btn btn-primary">2. Generate prompt + template</button>
          <button id="copy-prompt-btn" class="btn btn-ghost" disabled>Copy prompt</button>
        </div>
        <div id="prompt-output" class="hidden">
          <label class="block text-xs font-semibold text-[#9a9484] mb-1">Context prompt (copy this + the template into your AI)</label>
          <textarea id="generated-prompt" class="w-full h-40 field-input border border-[#e7e3d8] rounded-lg p-3 text-xs font-mono" readonly></textarea>
          <label class="block text-xs font-semibold text-[#9a9484] mb-1 mt-3">Data template</label>
          <textarea id="generated-template" class="w-full h-32 field-input border border-[#e7e3d8] rounded-lg p-3 text-xs font-mono" readonly></textarea>
        </div>
        <div>
          <label class="block text-xs font-semibold text-[#9a9484] mb-1">3. Paste completed JSON from your AI</label>
          <textarea id="paste-json" class="w-full h-32 field-input border border-[#e7e3d8] rounded-lg p-3 text-sm font-mono" placeholder='{"version":1,"nodes":[...],"links":[...]}'></textarea>
          <button id="load-pasted-btn" class="btn btn-primary mt-2">Load & render</button>
        </div>
      </div>
    `;
    grid.parentNode.insertBefore(panel, grid);

    // Hide advanced editor by default
    const dataCol = document.querySelector('.sankey-col-data');
    if (dataCol) dataCol.id = 'advanced-editor';
    const adv = document.getElementById('advanced-editor');
    if (adv) adv.classList.add('hidden');

    document.getElementById('generate-prompt-btn').addEventListener('click', function() {
      const req = document.getElementById('user-requirements').value.trim() || '(no specific requirements given)';
      const template = `{
  "version": 1,
  "nodes": [
    { "name": "Example Source", "color": "#1f8a5f" },
    { "name": "Example Target", "color": "#c0533e" }
  ],
  "links": [
    { "source": "Example Source", "target": "Example Target", "value": 100 }
  ]
}`;
      const prompt = `You are populating a Sankey data file for Make-Me-Sankey.

Return ONLY valid JSON matching this schema (no markdown fences, no explanation):
{
  "version": 1,
  "nodes": [{ "name": "string", "color": "#hex optional" }],
  "links": [{ "source": "exact node name", "target": "exact node name", "value": number }]
}

Rules:
- Node names must match exactly between nodes and links.
- Prefer restrained colors: green-ish (#1f8a5f) for profit/margin/income, red-ish (#c0533e) for cost/expense/loss; otherwise omit color so the tool applies neutral grey.
- Keep names short enough for labels (especially edge columns).
- Ensure inflow ≈ outflow on intermediate nodes where possible.
- User requirements: ${req}

Fill this template:
${template}`;

      document.getElementById('generated-prompt').value = prompt;
      document.getElementById('generated-template').value = template;
      document.getElementById('prompt-output').classList.remove('hidden');
      document.getElementById('copy-prompt-btn').disabled = false;
    });

    document.getElementById('copy-prompt-btn').addEventListener('click', function() {
      const full = document.getElementById('generated-prompt').value + '\n\n' + document.getElementById('generated-template').value;
      navigator.clipboard.writeText(full).then(() => {
        this.textContent = 'Copied!';
        setTimeout(() => this.textContent = 'Copy prompt', 1500);
      });
    });

    document.getElementById('load-pasted-btn').addEventListener('click', function() {
      const raw = document.getElementById('paste-json').value.trim();
      if (!raw) return alert('Paste the JSON first');
      try {
        const data = JSON.parse(raw);
        if (!data.nodes || !data.links) throw new Error('Missing nodes or links');
        if (typeof window.nodes !== 'undefined' && typeof window.links !== 'undefined' && typeof window.generateDiagram === 'function') {
          window.nodes = data.nodes;
          window.links = data.links;
          if (typeof window.renderNodes === 'function') window.renderNodes();
          if (typeof window.renderFlowsTable === 'function') window.renderFlowsTable();
          window.generateDiagram();
          alert('Loaded and rendered');
        } else {
          alert('JSON parsed. If the diagram did not update, open Advanced editor and use Import.');
          console.log(data);
        }
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
      }
    });

    document.getElementById('toggle-advanced-btn').addEventListener('click', function() {
      const adv = document.getElementById('advanced-editor');
      if (adv) {
        adv.classList.toggle('hidden');
        this.textContent = adv.classList.contains('hidden') ? 'Advanced editor ▾' : 'Advanced editor ▴';
      }
    });
  });
})();
