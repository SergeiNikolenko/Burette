(function () {
  'use strict';

  const METHODS = [
    ['auto', 'Auto', 'Residue numbers first, then sequence when numbering does not overlap.'],
    ['atoms', 'Residue numbers', 'Fit matching Cα atoms by author residue number.'],
    ['sequence', 'Sequence', 'Align residue sequences, then fit matched Cα atoms.'],
    ['binding-site', 'Binding site', 'Fit reference-chain Cα atoms within 10 Å of reference ligand heavy atoms.'],
    ['chains', 'Chains', 'Use Mol* chain superposition with optional sequence guidance.'],
    ['tm-align', 'TM-align', 'Structure-based single-chain alignment with directional TM-scores.'],
    ['uniprot', 'UniProt', 'Use intersecting SIFTS UniProt residue mappings.'],
    ['selected-atoms', 'Selected atoms', 'Fit ordered atom selections from each structure.'],
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function createSelect(label, options, value) {
    const row = element('label', 'buret-superposition-field');
    row.append(element('span', '', label));
    const select = document.createElement('select');
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      node.disabled = option.disabled === true;
      select.append(node);
    }
    if (value != null) select.value = String(value);
    row.append(select);
    return { row, select };
  }

  function methodDescription(method) {
    return METHODS.find(([value]) => value === method)?.[2] || '';
  }

  function methodNeedsChains(method) {
    return method !== 'uniprot' && method !== 'selected-atoms';
  }

  function formatMetric(value, digits = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
  }

  function create(options) {
    let entries = Array.isArray(options.entries) ? options.entries : [];
    let busy = false;
    let aligned = false;
    let result = null;
    const root = element('aside', 'buret-superposition-panel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-label', 'Burette Superposition');
    root.tabIndex = -1;
    root.hidden = true;

    const header = element('header', 'buret-superposition-header');
    const heading = element('div');
    heading.append(element('strong', '', 'Superposition'), element('span', '', 'Burette + Mol*'));
    const close = element('button', 'buret-superposition-close', '×');
    close.type = 'button';
    close.title = 'Close Superposition';
    close.setAttribute('aria-label', 'Close Superposition');
    header.append(heading, close);

    const body = element('div', 'buret-superposition-body');
    const referenceField = createSelect('Reference', entries.map(entry => ({ value: entry.id, label: entry.label })), entries[0]?.id);
    const moving = element('fieldset', 'buret-superposition-moving');
    const movingLegend = element('legend', '', 'Moving structures');
    moving.append(movingLegend);
    const methodSection = element('section', 'buret-superposition-methods');
    methodSection.append(element('div', 'buret-superposition-section-title', 'Method'));
    const methodGrid = element('div', 'buret-superposition-method-grid');
    const methodButtons = new Map();
    let selectedMethod = 'auto';
    for (const [value, label] of METHODS) {
      const button = element('button', '', label);
      button.type = 'button';
      button.dataset.method = value;
      button.classList.toggle('active', value === selectedMethod);
      button.setAttribute('aria-pressed', value === selectedMethod ? 'true' : 'false');
      methodButtons.set(value, button);
      methodGrid.append(button);
    }
    methodSection.append(methodGrid);
    const help = element('p', 'buret-superposition-help', methodDescription(selectedMethod));
    methodSection.append(help);
    const alignSequences = element('label', 'buret-superposition-option');
    const alignSequencesInput = document.createElement('input');
    alignSequencesInput.type = 'checkbox';
    alignSequencesInput.checked = true;
    alignSequences.append(alignSequencesInput, element('span', '', 'Guide chain fit by sequence alignment'));
    methodSection.append(alignSequences);

    const resultSection = element('section', 'buret-superposition-result');
    const resultHeading = element('div', 'buret-superposition-section-title', 'Result');
    const resultBody = element('div', 'buret-superposition-result-body', 'No superposition applied.');
    resultSection.append(resultHeading, resultBody);

    const footer = element('footer', 'buret-superposition-footer');
    const reset = element('button', 'buret-superposition-reset', 'Reset');
    reset.type = 'button';
    const apply = element('button', 'buret-superposition-apply', 'Apply');
    apply.type = 'button';
    footer.append(reset, apply);
    body.append(referenceField.row, moving, methodSection, resultSection, footer);
    root.append(header, body);
    document.body.append(root);

    function selectedReference() {
      return entries.find(entry => entry.id === referenceField.select.value) || entries[0] || null;
    }

    function selectedMovingIds() {
      return Array.from(moving.querySelectorAll('input[data-moving-id]:checked')).map(input => input.dataset.movingId);
    }

    function chainSelections() {
      const selected = {};
      for (const select of moving.querySelectorAll('select[data-chain-entry]')) {
        selected[select.dataset.chainEntry] = select.value;
      }
      const referenceChain = body.querySelector('select[data-reference-chain]');
      if (referenceChain) selected[referenceField.select.value] = referenceChain.value;
      return selected;
    }

    function chainOptions(entry) {
      return (entry?.chains || []).map(chain => ({ value: chain.id, label: chain.label }));
    }

    function renderMoving() {
      moving.replaceChildren(movingLegend);
      const reference = selectedReference();
      if (!reference) return;
      if (methodNeedsChains(selectedMethod)) {
        const chain = createSelect('Reference chain', chainOptions(reference), reference.chains?.[0]?.id);
        chain.row.classList.add('buret-superposition-reference-chain');
        chain.select.dataset.referenceChain = 'true';
        moving.append(chain.row);
      }
      for (const entry of entries) {
        if (entry.id === reference.id) continue;
        const row = element('div', 'buret-superposition-moving-row');
        const label = element('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = true;
        input.dataset.movingId = entry.id;
        label.append(input, element('span', '', entry.label));
        row.append(label);
        if (methodNeedsChains(selectedMethod)) {
          const select = document.createElement('select');
          select.dataset.chainEntry = entry.id;
          for (const option of chainOptions(entry)) {
            const node = document.createElement('option');
            node.value = option.value;
            node.textContent = option.label;
            select.append(node);
          }
          row.append(select);
        }
        moving.append(row);
      }
      refreshButtons();
    }

    function renderResult() {
      resultBody.replaceChildren();
      if (!result) {
        resultBody.textContent = aligned ? 'Superposition is active.' : 'No superposition applied.';
        return;
      }
      const summary = element('div', 'buret-superposition-result-summary');
      summary.append(element('strong', '', result.methodLabel || result.method || 'Superposition'));
      summary.append(element('span', '', `Reference: ${result.referenceLabel || '—'}`));
      resultBody.append(summary);
      for (const pair of result.pairs || []) {
        const row = element('div', 'buret-superposition-result-row');
        row.append(element('strong', '', pair.movingLabel || 'Moving structure'));
        const metrics = [`${pair.matchedCount ?? '—'} ${pair.matchedUnit || 'pairs'}`, `RMSD ${formatMetric(pair.rmsdAngstrom)} Å`];
        if (pair.tmScores) {
          metrics.push(`TM ${formatMetric(pair.tmScores.referenceNormalized, 4)} / ${formatMetric(pair.tmScores.movingNormalized, 4)}`);
        }
        row.append(element('span', '', metrics.join(' · ')));
        resultBody.append(row);
      }
      for (const warning of result.warnings || []) resultBody.append(element('p', 'buret-superposition-warning', warning));
    }

    function refreshButtons() {
      const movingIds = selectedMovingIds();
      apply.disabled = busy || movingIds.length === 0;
      apply.textContent = busy ? 'Applying…' : 'Apply';
      reset.disabled = busy || !aligned;
      referenceField.select.disabled = busy;
      for (const button of methodButtons.values()) button.disabled = busy;
      alignSequences.hidden = selectedMethod !== 'chains';
      const uniprot = methodButtons.get('uniprot');
      if (uniprot) {
        const selected = [selectedReference(), ...entries.filter(entry => movingIds.includes(entry.id))].filter(Boolean);
        const available = selected.length >= 2 && selected.every(entry => entry.canUseSifts === true);
        uniprot.disabled = busy || !available;
        uniprot.title = available ? '' : 'UniProt needs SIFTS mapping in every selected structure.';
      }
    }

    function setMethod(method) {
      if (!methodButtons.has(method)) return;
      selectedMethod = method;
      for (const [value, button] of methodButtons) {
        const active = value === selectedMethod;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      help.textContent = methodDescription(selectedMethod);
      renderMoving();
      refreshButtons();
    }

    for (const [method, button] of methodButtons) button.addEventListener('click', () => setMethod(method));
    referenceField.select.addEventListener('change', renderMoving);
    moving.addEventListener('change', refreshButtons);
    close.addEventListener('click', () => { root.hidden = true; options.onClose?.(); });
    reset.addEventListener('click', () => { Promise.resolve(options.onReset?.()).catch(() => {}); });
    apply.addEventListener('click', () => {
      const reference = selectedReference();
      if (!reference || busy) return;
      Promise.resolve(options.onApply?.({
        method: selectedMethod,
        referenceId: reference.id,
        movingIds: selectedMovingIds(),
        chains: chainSelections(),
        alignSequences: alignSequencesInput.checked,
      })).catch(() => {});
    });

    renderMoving();
    renderResult();
    refreshButtons();

    return {
      open(method) {
        if (method) setMethod(method);
        root.hidden = false;
        root.focus({ preventScroll: true });
      },
      close() { root.hidden = true; },
      destroy() { root.remove(); },
      isOpen() { return !root.hidden; },
      setBusy(value) { busy = Boolean(value); refreshButtons(); },
      setAligned(value) { aligned = Boolean(value); refreshButtons(); renderResult(); },
      setResult(value) { result = value || null; aligned = Boolean(value); refreshButtons(); renderResult(); },
      setEntries(value) {
        entries = Array.isArray(value) ? value : [];
        referenceField.select.replaceChildren();
        for (const entry of entries) {
          const option = document.createElement('option');
          option.value = entry.id;
          option.textContent = entry.label;
          referenceField.select.append(option);
        }
        renderMoving();
      },
      element: root,
    };
  }

  window.BuretteSuperpositionPanel = Object.freeze({ create });
})();
