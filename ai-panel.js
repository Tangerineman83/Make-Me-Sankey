// AI primary copy-paste flow. Loaded after the inline app script.
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function template() {
    return {
      version: 2,
      nodes: [
        { name: 'Total', color: { themeIndex: 0, variant: 'base' } },
        { name: 'Category A', color: { themeIndex: 1, variant: 'base' } },
        { name: 'Category B', color: { themeIndex: 2, variant: 'base' } },
        { name: 'Outcome', color: { themeIndex: 0, variant: 'base' } }
      ],
      links: [
        { source: 'Total', target: 'Category A', value: 60 },
        { source: 'Total', target: 'Category B', value: 40 },
        { source: 'Category A', target: 'Outcome', value: 60 },
        { source: 'Category B', target: 'Outcome', value: 40 }
      ],
      columnLabels: ['Start', 'Category', 'End']
    };
  }

  ready(function () {
    const grid = document.querySelector('.sankey-layout-grid');
    if (!grid || document.getElementById('ai-primary-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'ai-primary-panel';
    panel.className = 'panel mb-6';
    panel.innerHTML = [
      '<div class="panel-header">',
      '  <div>',
      '    <div class="panel-title">Describe your flows</div>',
      '    <div class="panel-subtitle">Primary path. An AI fills the data file. Open the editor only if you want to tweak it.</div>',
      '  </div>',
      '  <button type="button" id="toggle-advanced-btn" class="btn btn-ghost text-xs">Advanced editor</button>',
      '</div>',
      '<div class="p-4 space-y-4">',
      '  <div>',
      '    <label class="block text-xs font-semibold text-[#9a9484] mb-1">1. Your requirements</label>',
      '    <textarea id="user-requirements" class="w-full h-24 field-input border border-[#e7e3d8] rounded-lg p-3 text-sm" placeholder="e.g. Revenue splits into Direct and Partner, then into Gross Margin and Cost of Sales."></textarea>',
      '  </div>',
      '  <div class="flex gap-2">',
      '    <button type="button" id="generate-prompt-btn" class="btn btn-primary">2. Generate prompt</button>',
      '    <button type="button" id="copy-prompt-btn" class="btn btn-ghost" disabled>Copy prompt</button>',
      '  </div>',
      '  <div id="prompt-output" class="hidden">',
      '    <label class="block text-xs font-semibold text-[#9a9484] mb-1">Prompt, including the data shape. Copy this whole block into your AI.</label>',
      '    <textarea id="generated-prompt" class="w-full h-56 field-input border border-[#e7e3d8] rounded-lg p-3 text-xs font-mono" readonly></textarea>',
      '  </div>',
      '  <div>',
      '    <label class="block text-xs font-semibold text-[#9a9484] mb-1">3. Paste the completed JSON</label>',
      '    <textarea id="paste-json" class="w-full h-32 field-input border border-[#e7e3d8] rounded-lg p-3 text-sm font-mono" placeholder='Paste the JSON your AI returned'></textarea>',
      '    <button type="button" id="load-pasted-btn" class="btn btn-primary mt-2">Load and render</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    grid.parentNode.insertBefore(panel, grid);

    const dataCol = document.querySelector('.sankey-col-data');
    if (dataCol) {
      dataCol.id = 'advanced-editor';
      dataCol.classList.add('hidden');
    }

    document.getElementById('generate-prompt-btn').addEventListener('click', function () {
      const req = document.getElementById('user-requirements').value.trim() || '(no specific requirements given)';
      const tmpl = JSON.stringify(template(), null, 2);
      const instructions = (typeof window.buildExportInstructions === 'function')
        ? JSON.stringify(window.buildExportInstructions(), null, 2)
        : 'Use version 2. Node color must be {themeIndex: 0-7, variant: "base"|"tint0"|"tint1"|"tint2"|"tint3"|"tint4"|"shade0"|"shade1"}. Do not use hex colors.';
      const prompt = [
        'You are populating a Sankey data file for Make-Me-Sankey.',
        'Return ONLY valid JSON. No markdown fences. No commentary.',
        'The importer rejects version 1 and rejects hex color strings.',
        'Follow these instructions exactly:',
        instructions,
        '',
        'User requirements:',
        req,
        '',
        'Replace the example JSON below with the user\'s data. Return that JSON only:',
        tmpl
      ].join('\n');
      document.getElementById('generated-prompt').value = prompt;
      document.getElementById('prompt-output').classList.remove('hidden');
      document.getElementById('copy-prompt-btn').disabled = false;
    });

    document.getElementById('copy-prompt-btn').addEventListener('click', function () {
      const full = document.getElementById('generated-prompt').value;
      const btn = this;
      navigator.clipboard.writeText(full).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy prompt'; }, 1500);
      });
    });

    document.getElementById('load-pasted-btn').addEventListener('click', function () {
      let raw = document.getElementById('paste-json').value.trim();
      if (!raw) return alert('Paste the JSON first');
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      let data;
      try { data = JSON.parse(raw); }
      catch (e) { return alert('Invalid JSON: ' + e.message); }
      if (typeof window.applyImportedSankeyData !== 'function') {
        return alert('Importer is not available. Reload the page.');
      }
      try {
        window.applyImportedSankeyData(data);
      } catch (e) {
        alert("Couldn't load this file: " + e.message);
      }
    });

    document.getElementById('toggle-advanced-btn').addEventListener('click', function () {
      const adv = document.getElementById('advanced-editor');
      if (!adv) return;
      adv.classList.toggle('hidden');
      this.textContent = adv.classList.contains('hidden') ? 'Advanced editor' : 'Hide editor';
    });
  });
})();
