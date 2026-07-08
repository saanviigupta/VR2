/**
 * items.js  —  Kawaii Bakery (v6)
 *
 * Gameplay, layout, counts and visuals UNCHANGED from your v5.
 * (VR grabbing fixes live in vr.js/game.js; item entities already carry the
 * invisible raycast-hit geometry and manual-fit ammo shapes they need.)
 */

window.addEventListener('DOMContentLoaded', () => {
  const scene = document.querySelector('a-scene');
  if (!scene) { console.warn('[items.js] a-scene not found'); return; }

  scene.addEventListener('loaded', () => {
    console.log('[items.js] scene loaded — building items');

    // ── Item counts ─────────────────────────────────────────────
    const itemDefinitions = [
      { type: 'croissant',  emoji: '🥐', count: 5, zone: 'zone-croissant' },
      { type: 'bread',      emoji: '🥖', count: 2, zone: 'zone-bread'     },
      { type: 'pastry',     emoji: '🍰', count: 2, zone: 'zone-pastry'    },
      { type: 'cupcake',    emoji: '🧁', count: 5, zone: 'zone-cupcake'   },
      { type: 'cookie',     emoji: '🍪', count: 2, zone: 'zone-cookie'    },
      { type: 'donut',      emoji: '🍩', count: 2, zone: 'zone-donut'     },
      { type: 'macaron',    emoji: '🫐', count: 2, zone: 'zone-macaron'   },
      { type: 'muffin',     emoji: '🧁', count: 2, zone: 'zone-muffin'    },
      { type: 'brownie',    emoji: '🍫', count: 2, zone: 'zone-brownie'   },
      { type: 'dirty-dish', emoji: '🍽', count: 2, zone: 'zone-sink'      },
      { type: 'fork',       emoji: '🍴', count: 3, zone: 'zone-fork'      },
      { type: 'spoon',      emoji: '🥄', count: 3, zone: 'zone-spoon'     },
    ];

    // ── Spawn surfaces ──────────────────────────────────────────
    const surfaces = [
      { y: 1.18, xMin: -2.1, xMax:  2.1, zMin: -1.88, zMax: -1.12 },
      { y: 0.98, xMin: -2.8, xMax: -1.2, zMin:  0.1,  zMax:  0.9  },
      { y: 0.06, xMin: -3.6, xMax: -1.0, zMin:  1.1,  zMax:  2.0  },
    ];

    const SLOT_SPACING = 0.44;
    const allSlots = [];
    for (const surf of surfaces) {
      const cols = Math.max(1, Math.floor((surf.xMax - surf.xMin) / SLOT_SPACING));
      const rows = Math.max(1, Math.floor((surf.zMax - surf.zMin) / SLOT_SPACING));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          allSlots.push({
            x: +(surf.xMin + c * SLOT_SPACING + SLOT_SPACING / 2 + (Math.random() * 0.04 - 0.02)).toFixed(3),
            y: surf.y,
            z: +(surf.zMin + r * SLOT_SPACING + SLOT_SPACING / 2 + (Math.random() * 0.04 - 0.02)).toFixed(3),
          });
        }
      }
    }

    // Fisher-Yates shuffle
    for (let i = allSlots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allSlots[i], allSlots[j]] = [allSlots[j], allSlots[i]];
    }

    let slotIdx = 0;
    function nextSlot() {
      if (slotIdx >= allSlots.length) { slotIdx = 0; console.warn('[items.js] recycling slots'); }
      return allSlots[slotIdx++];
    }

    // ── Drop zones ───────────────────────────────────────────────
    const extraZones = [
      { id: 'zone-cupcake', type: 'cupcake',  pos: '0 0.9 -5.25',     label: '🧁 Cupcakes'  },
      { id: 'zone-cookie',  type: 'cookie',   pos: '-1.8 0.9 -5.25',  label: '🍪 Cookies'   },
      { id: 'zone-donut',   type: 'donut',    pos: '1.8 0.9 -5.25',   label: '🍩 Donuts'    },
      { id: 'zone-macaron', type: 'macaron',  pos: '-2.0 1.78 -5.35', label: '🫐 Macarons'  },
      { id: 'zone-muffin',  type: 'muffin',   pos: '2.0 1.78 -5.35',  label: '🧁 Muffins'   },
      { id: 'zone-brownie', type: 'brownie',  pos: '0 2.68 -5.35',    label: '🍫 Brownies'  },
      { id: 'zone-fork',  type: 'fork',  pos: '5.77 2.08 -0.5', label: '🍴 Forks'  },
      { id: 'zone-spoon', type: 'spoon', pos: '5.77 2.08 -1.5', label: '🥄 Spoons' },
    ];

    extraZones.forEach((z) => {
      if (document.getElementById(z.id)) return;
      const el = document.createElement('a-entity');
      el.setAttribute('id', z.id);
      el.setAttribute('class', 'drop-zone');
      el.setAttribute('zone-type', z.type);
      el.setAttribute('position', z.pos);
      el.setAttribute('drop-zone', '');

      // Invisible raycast-hit geometry on the parent so cursor/laser events
      // fire on the .drop-zone entity (where the drop-zone component listens).
      el.setAttribute('geometry', 'primitive: box; width: 0.8; height: 0.12; depth: 0.32');
      el.setAttribute('material', 'opacity: 0; transparent: true; shader: flat');

      const box = document.createElement('a-box');
      box.setAttribute('width', '0.75');
      box.setAttribute('height', '0.07');
      box.setAttribute('depth', '0.28');
      box.setAttribute('class', 'zone-visual');
      box.setAttribute('material',
        'color: #ffd0e8; opacity: 0.5; transparent: true; emissive: #ff80c0; emissiveIntensity: 0.45');
      el.appendChild(box);

      const txt = document.createElement('a-text');
      txt.setAttribute('value', z.label);
      txt.setAttribute('align', 'center');
      txt.setAttribute('position', '0 0.22 0');
      txt.setAttribute('width', '3.5');
      txt.setAttribute('color', '#a0006a');
      // Fork/spoon zones on the side wall need rotated text
      if (z.pos.startsWith('5.77')) {
        txt.setAttribute('rotation', '0 -90 0');
        txt.setAttribute('position', '-0.3 0.22 0');
      }
      el.appendChild(txt);
      scene.appendChild(el);
    });

    // Fix existing zone label sizes in HTML
    document.querySelectorAll('.drop-zone a-text').forEach((t) => {
      t.setAttribute('width', '3.5');
      if (!t.getAttribute('position') || t.getAttribute('position') === '0 0 0') {
        t.setAttribute('position', '0 0.25 0');
      }
    });

    // ── Visual builder (all designs unchanged) ──────────────────
    function buildVisual(type) {
      const group = document.createElement('a-entity');

      switch (type) {

        case 'croissant': {
          const body = document.createElement('a-torus');
          body.setAttribute('radius', '0.13');
          body.setAttribute('radius-tubular', '0.048');
          body.setAttribute('arc', '200');
          body.setAttribute('material', 'color: #d4882a; roughness: 0.7; emissive: #a05010; emissiveIntensity: 0.15');
          group.appendChild(body);
          const sheen = document.createElement('a-torus');
          sheen.setAttribute('radius', '0.13');
          sheen.setAttribute('radius-tubular', '0.024');
          sheen.setAttribute('arc', '200');
          sheen.setAttribute('rotation', '0 0 180');
          sheen.setAttribute('material', 'color: #f0c060; roughness: 0.5; emissive: #c08820; emissiveIntensity: 0.2');
          group.appendChild(sheen);
          break;
        }

        case 'bread': {
          const loaf = document.createElement('a-sphere');
          loaf.setAttribute('radius', '0.13');
          loaf.setAttribute('scale', '1.5 0.75 1.0');
          loaf.setAttribute('material', 'color: #c47a18; roughness: 0.9; emissive: #8a4008; emissiveIntensity: 0.12');
          group.appendChild(loaf);
          const score = document.createElement('a-box');
          score.setAttribute('width', '0.02');
          score.setAttribute('height', '0.08');
          score.setAttribute('depth', '0.26');
          score.setAttribute('position', '0 0.08 0');
          score.setAttribute('material', 'color: #7a3a05; roughness: 1.0');
          group.appendChild(score);
          break;
        }

        case 'pastry':
        case 'cake': {
          const base = document.createElement('a-cone');
          base.setAttribute('radius-bottom', '0.14');
          base.setAttribute('radius-top', '0.11');
          base.setAttribute('height', '0.13');
          base.setAttribute('material', 'color: #f9c8e0; roughness: 0.5; emissive: #e060a0; emissiveIntensity: 0.15');
          group.appendChild(base);
          const icing = document.createElement('a-cylinder');
          icing.setAttribute('radius', '0.12');
          icing.setAttribute('height', '0.03');
          icing.setAttribute('position', '0 0.08 0');
          icing.setAttribute('material', 'color: #ffffff; roughness: 0.3; emissive: #ffaad8; emissiveIntensity: 0.25');
          group.appendChild(icing);
          const cherry = document.createElement('a-sphere');
          cherry.setAttribute('radius', '0.025');
          cherry.setAttribute('position', '0 0.11 0');
          cherry.setAttribute('material', 'color: #ff2244; emissive: #ff0020; emissiveIntensity: 0.5');
          group.appendChild(cherry);
          break;
        }

        case 'cupcake':
        case 'muffin': {
          const cup = document.createElement('a-cone');
          cup.setAttribute('radius-bottom', '0.09');
          cup.setAttribute('radius-top', '0.11');
          cup.setAttribute('height', '0.10');
          cup.setAttribute('material', 'color: #ffd6e8; roughness: 0.7');
          group.appendChild(cup);
          const dome = document.createElement('a-sphere');
          dome.setAttribute('radius', '0.10');
          dome.setAttribute('position', '0 0.09 0');
          dome.setAttribute('scale', '1 0.75 1');
          dome.setAttribute('material', 'color: #ff80c0; roughness: 0.4; emissive: #d04080; emissiveIntensity: 0.2');
          group.appendChild(dome);
          const colours = ['#ffff00', '#00ffaa', '#ff4488', '#44aaff'];
          for (let s = 0; s < 5; s++) {
            const sp = document.createElement('a-sphere');
            sp.setAttribute('radius', '0.012');
            const angle = (s / 5) * Math.PI * 2;
            sp.setAttribute('position', `${(Math.cos(angle) * 0.06).toFixed(3)} 0.14 ${(Math.sin(angle) * 0.06).toFixed(3)}`);
            sp.setAttribute('material', `color: ${colours[s % colours.length]}; emissive: ${colours[s % colours.length]}; emissiveIntensity: 0.6`);
            group.appendChild(sp);
          }
          break;
        }

        case 'cookie': {
          const cyl = document.createElement('a-cylinder');
          cyl.setAttribute('radius', '0.11');
          cyl.setAttribute('height', '0.022');
          cyl.setAttribute('material', 'color: #d89048; roughness: 0.9; emissive: #884010; emissiveIntensity: 0.1');
          group.appendChild(cyl);
          for (let c = 0; c < 6; c++) {
            const chip = document.createElement('a-sphere');
            chip.setAttribute('radius', '0.015');
            const a = (c / 6) * Math.PI * 2;
            chip.setAttribute('position', `${(Math.cos(a) * 0.065).toFixed(3)} 0.013 ${(Math.sin(a) * 0.065).toFixed(3)}`);
            chip.setAttribute('material', 'color: #3a1a00; emissive: #200800; emissiveIntensity: 0.3');
            group.appendChild(chip);
          }
          break;
        }

        case 'donut': {
          const ring = document.createElement('a-torus');
          ring.setAttribute('radius', '0.10');
          ring.setAttribute('radius-tubular', '0.042');
          ring.setAttribute('material', 'color: #e0902a; roughness: 0.7; emissive: #904010; emissiveIntensity: 0.12');
          group.appendChild(ring);
          const glaze = document.createElement('a-torus');
          glaze.setAttribute('radius', '0.10');
          glaze.setAttribute('radius-tubular', '0.020');
          glaze.setAttribute('position', '0 0.02 0');
          glaze.setAttribute('material', 'color: #ff90d0; roughness: 0.3; emissive: #ff50a0; emissiveIntensity: 0.3');
          group.appendChild(glaze);
          break;
        }

        case 'macaron': {
          const top = document.createElement('a-cylinder');
          top.setAttribute('radius', '0.09');
          top.setAttribute('height', '0.04');
          top.setAttribute('position', '0 0.03 0');
          top.setAttribute('material', 'color: #cc88ff; roughness: 0.4; emissive: #8800cc; emissiveIntensity: 0.2');
          group.appendChild(top);
          const fill = document.createElement('a-cylinder');
          fill.setAttribute('radius', '0.085');
          fill.setAttribute('height', '0.02');
          fill.setAttribute('material', 'color: #ffffff; roughness: 0.3; emissive: #ffccff; emissiveIntensity: 0.3');
          group.appendChild(fill);
          const bot = document.createElement('a-cylinder');
          bot.setAttribute('radius', '0.09');
          bot.setAttribute('height', '0.04');
          bot.setAttribute('position', '0 -0.03 0');
          bot.setAttribute('material', 'color: #cc88ff; roughness: 0.4; emissive: #8800cc; emissiveIntensity: 0.2');
          group.appendChild(bot);
          break;
        }

        case 'brownie': {
          const brow = document.createElement('a-box');
          brow.setAttribute('width', '0.18');
          brow.setAttribute('height', '0.07');
          brow.setAttribute('depth', '0.18');
          brow.setAttribute('material', 'color: #3a1a00; roughness: 0.9; emissive: #1a0800; emissiveIntensity: 0.2');
          group.appendChild(brow);
          const glaze2 = document.createElement('a-box');
          glaze2.setAttribute('width', '0.16');
          glaze2.setAttribute('height', '0.015');
          glaze2.setAttribute('depth', '0.16');
          glaze2.setAttribute('position', '0 0.04 0');
          glaze2.setAttribute('material', 'color: #5a2a00; roughness: 0.6; emissive: #cc6600; emissiveIntensity: 0.15');
          group.appendChild(glaze2);
          break;
        }

        case 'dirty-dish': {
          const plate = document.createElement('a-cylinder');
          plate.setAttribute('radius', '0.13');
          plate.setAttribute('height', '0.018');
          plate.setAttribute('material', 'color: #e8e0f0; roughness: 0.4');
          group.appendChild(plate);
          const rim = document.createElement('a-torus');
          rim.setAttribute('radius', '0.12');
          rim.setAttribute('radius-tubular', '0.008');
          rim.setAttribute('material', 'color: #c0b0d0; roughness: 0.5');
          group.appendChild(rim);
          const stain = document.createElement('a-sphere');
          stain.setAttribute('radius', '0.04');
          stain.setAttribute('position', '0.04 0.012 0.03');
          stain.setAttribute('scale', '1.5 0.2 1');
          stain.setAttribute('material', 'color: #886644; roughness: 0.9; emissive: #442200; emissiveIntensity: 0.1');
          group.appendChild(stain);
          break;
        }

        case 'fork': {
          const handle = document.createElement('a-box');
          handle.setAttribute('width', '0.025');
          handle.setAttribute('height', '0.28');
          handle.setAttribute('depth', '0.025');
          handle.setAttribute('position', '0 -0.07 0');
          handle.setAttribute('material', 'color: #d0d0e8; metalness: 0.85; roughness: 0.15; emissive: #8888cc; emissiveIntensity: 0.1');
          group.appendChild(handle);
          const neck = document.createElement('a-box');
          neck.setAttribute('width', '0.022');
          neck.setAttribute('height', '0.06');
          neck.setAttribute('depth', '0.022');
          neck.setAttribute('position', '0 0.1 0');
          neck.setAttribute('material', 'color: #d0d0e8; metalness: 0.85; roughness: 0.15');
          group.appendChild(neck);
          const tineOffsets = [-0.03, -0.01, 0.01, 0.03];
          tineOffsets.forEach((ox) => {
            const tine = document.createElement('a-box');
            tine.setAttribute('width', '0.012');
            tine.setAttribute('height', '0.09');
            tine.setAttribute('depth', '0.012');
            tine.setAttribute('position', `${ox} 0.185 0`);
            tine.setAttribute('material', 'color: #e0e0f8; metalness: 0.9; roughness: 0.1; emissive: #aaaadd; emissiveIntensity: 0.15');
            group.appendChild(tine);
          });
          break;
        }

        case 'spoon': {
          const shandle = document.createElement('a-box');
          shandle.setAttribute('width', '0.025');
          shandle.setAttribute('height', '0.26');
          shandle.setAttribute('depth', '0.025');
          shandle.setAttribute('position', '0 -0.06 0');
          shandle.setAttribute('material', 'color: #d0d0e8; metalness: 0.85; roughness: 0.15; emissive: #8888cc; emissiveIntensity: 0.1');
          group.appendChild(shandle);
          const bowl = document.createElement('a-sphere');
          bowl.setAttribute('radius', '0.06');
          bowl.setAttribute('scale', '0.8 0.45 1');
          bowl.setAttribute('position', '0 0.16 0');
          bowl.setAttribute('material', 'color: #e0e0f8; metalness: 0.9; roughness: 0.1; emissive: #aaaadd; emissiveIntensity: 0.2');
          group.appendChild(bowl);
          break;
        }

        default: {
          const sph = document.createElement('a-sphere');
          sph.setAttribute('radius', '0.09');
          sph.setAttribute('material', 'color: #ff80c0; roughness: 0.5; emissive: #ff0080; emissiveIntensity: 0.2');
          group.appendChild(sph);
        }
      }

      return group;
    }

    // ── Build all items ──────────────────────────────────────────
    let created = 0;

    itemDefinitions.forEach((def) => {
      for (let i = 0; i < def.count; i++) {
        const slot = nextSlot();

        const ent = document.createElement('a-entity');
        ent.setAttribute('class', 'interactable');
        ent.setAttribute('item-type', def.type);
        ent.setAttribute('target-zone', def.zone);
        ent.setAttribute('pickupable', '');
        ent.setAttribute('position', `${slot.x} ${slot.y} ${slot.z}`);
        ent.setAttribute('rotation', `0 ${Math.floor(Math.random() * 360)} 0`);

        // Kinematic physics — animation-driven until placed / thrown.
        // fit: manual is required with explicit halfExtents.
        ent.setAttribute('ammo-body', 'type: kinematic; emitCollisionEvents: true');
        ent.setAttribute('ammo-shape', 'type: box; fit: manual; halfExtents: 0.12 0.1 0.12');

        // Invisible collision geometry so raycasters can hit the parent
        // entity directly (events fire where pickupable listens).
        ent.setAttribute('geometry', 'primitive: box; width: 0.28; height: 0.24; depth: 0.28');
        ent.setAttribute('material', 'opacity: 0; transparent: true; shader: flat');

        const visual = buildVisual(def.type);
        ent.appendChild(visual);

        // Forward clicks from all children → parent pickup
        const forwardClick = (ev) => {
          ev.stopPropagation();
          if (window.bakeryGame) {
            const holder = (ev.detail && ev.detail.cursorEl) ? ev.detail.cursorEl : null;
            window.bakeryGame.pickUpItem(ent, holder);
          }
        };

        scene.appendChild(ent);
        ent.querySelectorAll('*').forEach((child) => {
          child.addEventListener('click', forwardClick);
        });

        // Gentle idle bob
        ent.setAttribute('animation__bob', {
          property: 'position',
          from: `${slot.x} ${slot.y} ${slot.z}`,
          to:   `${slot.x} ${(parseFloat(slot.y) + 0.06).toFixed(3)} ${slot.z}`,
          dur: 1800 + Math.floor(Math.random() * 800),
          dir: 'alternate',
          loop: true,
          easing: 'easeInOutSine',
        });

        created++;
      }
    });

    window.BAKERY_TOTAL_ITEMS = created;
    console.log('[items.js] created', created, 'items across', slotIdx, 'unique slots');
  });
});
