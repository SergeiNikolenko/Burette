(function () {
  'use strict';
  const fail = () => { throw new Error('This source cannot produce a bounded molecular depiction.'); };
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/u;
  const point = values => {
    if (values.length !== 3 || values.some(value => !number.test(value))) fail();
    const result = values.map(Number);
    if (result.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) fail();
    return result;
  };
  // Preflight counts before OCL can allocate, and retain the physical source
  // positions independently of its internal coordinate frame and H sorting.
  function sourcePositions(source) {
    if (typeof source !== 'string' || source.length > 2_000_000 || source.includes('\0') || new TextEncoder().encode(source).length > 2_000_000) fail();
    const records = source.replace(/\r\n?/gu, '\n').split(/^\$\$\$\$[ \t]*$/mu);
    if (records.slice(1).some(record => record.trim())) fail();
    const lines = records[0].split('\n'), version = /\bV(2000|3000)\b/u.exec(lines[3] || '')?.[1];
    let count, bonds;
    const counts = (a, b) => {
      if (!/^\d+$/u.test(a) || !/^\d+$/u.test(b)) fail();
      count = Number(a); bonds = Number(b);
      if (count < 1 || count > 512 || bonds > 4096) fail();
    };
    if (version === '2000') {
      counts(lines[3].slice(0, 3).trim(), lines[3].slice(3, 6).trim());
      if (lines.length < count + bonds + 5 || !lines.slice(count + bonds + 4).some(line => /^M\s+END\s*$/u.test(line))) fail();
      return { bonds, positions: lines.slice(4, count + 4).map(line => point([line.slice(0, 10).trim(), line.slice(10, 20).trim(), line.slice(20, 30).trim()])) };
    }
    if (version !== '3000') fail();
    const positions = [], ids = new Set();
    let block = '', atomBlock = false, bondBlock = false, bondRows = 0, ended = false;
    for (let i = 4; i < lines.length; i++) {
      if (/^M\s+END\s*$/u.test(lines[i])) { ended = true; break; }
      if (!lines[i].trim()) continue;
      let logical = '', continued;
      for (let parts = 0; ; parts++, i++) {
        if (parts >= 256) fail();
        const match = /^M\s+V30\s+(.*)$/u.exec(lines[i] || '');
        if (!match) fail();
        const value = match[1].trimEnd(); continued = value.endsWith('-');
        logical += continued ? value.slice(0, -1) : value;
        if (logical.length > 65_536) fail();
        if (!continued) break;
      }
      const fields = logical.trim().split(/\s+/u);
      if (fields[0] === 'COUNTS') { if (count !== undefined || block) fail(); counts(fields[1], fields[2]); }
      else if (logical.trim() === 'BEGIN ATOM') { if (!count || atomBlock || block) fail(); atomBlock = true; block = 'ATOM'; }
      else if (logical.trim() === 'END ATOM') { if (block !== 'ATOM' || positions.length !== count) fail(); block = ''; }
      else if (logical.trim() === 'BEGIN BOND') { if (!atomBlock || bondBlock || block) fail(); bondBlock = true; block = 'BOND'; }
      else if (logical.trim() === 'END BOND') { if (block !== 'BOND' || bondRows !== bonds) fail(); block = ''; }
      else if (block === 'ATOM') {
        if (positions.length >= count || !/^[1-9]\d*$/u.test(fields[0]) || !Number.isSafeInteger(Number(fields[0])) || ids.has(Number(fields[0]))) fail();
        ids.add(Number(fields[0])); positions.push(point(fields.slice(2, 5)));
      } else if (block === 'BOND') {
        if (++bondRows > bonds || !ids.has(Number(fields[2])) || !ids.has(Number(fields[3])) || fields[2] === fields[3]) fail();
      }
    }
    if (!ended || block || !atomBlock || positions.length !== count || bondRows !== bonds) fail();
    return { positions, bonds };
  }

  function render(source, showHydrogens, size, ocl) {
    if (typeof showHydrogens !== 'boolean' || !Number.isInteger(size) || size < 64 || size > 2048 || !ocl?.Molecule?.fromMolfileWithAtomMap) fail();
    const original = sourcePositions(source);
    const { molecule, map: sourceMap } = ocl.Molecule.fromMolfileWithAtomMap(source) || {};
    const map = Array.from(sourceMap || []), count = original.positions.length;
    if (!molecule || molecule.getAllAtoms() !== count || molecule.getAllBonds() !== original.bonds || map.length !== count
      || new Set(map).size !== count || map.some(index => !Number.isInteger(index) || index < 0 || index >= count)) fail();
    // Only this disposable depiction molecule receives source-index tags and
    // invented 2D coordinates. The input and the viewer's molecule stay intact.
    // OCL's map addresses the helper-normalized atom order; V3000 parsing may
    // defer the actual plain-H reordering until the helpers are requested.
    molecule.ensureHelperArrays(ocl.Molecule.cHelperCIP);
    map.forEach((atom, sourceIndex) => molecule.setAtomMapNo(atom, sourceIndex + 1));
    if (!showHydrogens) molecule.removeExplicitHydrogens();
    molecule.inventCoordinates({ keepHydrogens: true });
    let svg = molecule.toSVG(size, size, 'buret-ocl-preview', { maxAVBL: Math.round(size / 6), suppressChiralText: true, noColorOnESRAndCIP: true });
    if (typeof svg !== 'string' || svg.length > 2_000_000 || !svg.includes('<svg')) fail();
    const atomSource = atom => {
      if (!Number.isInteger(atom) || atom < 0 || atom >= molecule.getAllAtoms()) fail();
      const sourceIndex = molecule.getAtomMapNo(atom) - 1;
      if (!Number.isInteger(sourceIndex) || !original.positions[sourceIndex]) fail();
      return sourceIndex;
    };
    const atoms = new Set(), bonds = new Set();
    svg = svg.replace(/<circle\b[^>]*\bid="buret-ocl-preview:Atom:(\d+)"[^>]*\/>/gu, (tag, id) => {
      const atom = Number(id), sourceIndex = atomSource(atom);
      if (atoms.has(atom)) fail(); atoms.add(atom);
      return tag.replace(/\s(?:id|class|opacity|data-atom-map-no)="[^"]*"/gu, '')
        .replace('<circle', `<circle class="buret-preview-atom atom-${sourceIndex}" data-source-atom-index="${sourceIndex}" data-source-position="${original.positions[sourceIndex].join(',')}" fill="none" stroke="none"`);
    });
    // Reuse OCL's exact bond hit geometry for the existing lasso highlight;
    // the visible single/double/wedge drawing remains OCL's original SVG.
    svg = svg.replace(/<line\b[^>]*\bid="buret-ocl-preview:Bond:(\d+)"[^>]*\/>/gu, (tag, id) => {
      const bond = Number(id), values = ['x1', 'y1', 'x2', 'y2'].map(key => Number(new RegExp(`\\b${key}="([^"]+)"`, 'u').exec(tag)?.[1]));
      if (bond >= molecule.getAllBonds() || bonds.has(bond) || values.some(value => !Number.isFinite(value))) fail(); bonds.add(bond);
      const a = atomSource(molecule.getBondAtom(0, bond)), b = atomSource(molecule.getBondAtom(1, bond));
      return `<path class="bond-${bond} atom-${a} atom-${b}" d="M ${values[0]} ${values[1]} L ${values[2]} ${values[3]}" fill="none" stroke="none" />`;
    });
    if (atoms.size !== molecule.getAllAtoms() || bonds.size !== molecule.getAllBonds()) fail();
    svg = svg.replace(/rgb\(0,\s*0,\s*0\)/gu, 'var(--depiction-carbon)')
      .replace(/rgb\(48,\s*80,\s*248\)/gu, 'var(--depiction-nitrogen)')
      .replace(/rgb\(255,\s*13,\s*13\)/gu, 'var(--depiction-oxygen)')
      .replace('<svg ', '<svg style="width:100%;height:100%;display:block" ');
    if (new TextEncoder().encode(svg).length > 2_000_000) fail();
    return svg;
  }
  window.BuretteMoleculePreviewOcl = { render };
})();
