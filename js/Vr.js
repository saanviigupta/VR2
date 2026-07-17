/**
 * 🍰 Kawaii Bakery — VR Support (v7 — LITERAL grab-test purple code)
 * vr.js
 *
 * The purple cube grabbed fine in grab-test.html but not in the game, even
 * though the input code was the same. The difference: in the game, grabbing
 * routed through the game's pickup system (window.bakeryGame). So the game
 * layer was eating the grab.
 *
 * v7 uses the EXACT grab-test mechanism, with zero game dependency:
 *   - raw-pose: hand entities driven straight from the XR frame  (same)
 *   - purple-grab: ANY button near an item → object3D.attach the item
 *     to the hand; release all buttons → detach in place            (same)
 *   - in-VR log board printing every event                          (same)
 *
 * Only AFTER a successful direct grab/release does it optionally talk to
 * the game: on release, if the item sits within reach of its matching
 * drop zone, the zone placement + score + sparkles run. If the game code
 * isn't there or errors, grabbing itself still works regardless.
 */

var VR_GRAB_RADIUS = 0.45;  // metres — hand-to-item grab reach (original)
var VR_SNAP_RADIUS = 0.45;  // metres — item-to-zone snap distance on release

/* ── in-VR log board (from grab-test) ─────────────────────────── */
var LOG_LINES = [];
function vrlog(msg) {
  console.log('[vr.js] ' + msg);
  LOG_LINES.unshift(msg);
  if (LOG_LINES.length > 8) LOG_LINES.pop();
  var board = document.querySelector('#vr-log-text');
  if (board) board.setAttribute('value', LOG_LINES.join('\n'));
}

/* ── helpers (from grab-test) ─────────────────────────────────── */
function vrNearest(selector, worldPos, maxDist, filterFn) {
  var els = document.querySelectorAll(selector);
  var best = null, bestD = maxDist;
  var p = new THREE.Vector3();
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!el.object3D) continue;
    if (filterFn && !filterFn(el)) continue;
    el.object3D.getWorldPosition(p);
    var d = p.distanceTo(worldPos);
    if (d < bestD) { bestD = d; best = el; }
  }
  return best;
}

function vrHandEntity(handedness) {
  return document.querySelector(handedness === 'left' ? '#leftHand' : '#rightHand');
}

/* Direct attach/detach — LITERALLY the grab-test purple mechanism. */
function vrAttachTo(item, hand) {
  if (item._held) return;
  item._held = true;

  // Neutralize things that could fight the direct attach:
  try { item.removeAttribute('animation__bob'); } catch (e) {}
  try { item.removeAttribute('animation__return'); } catch (e) {}
  try { item.removeAttribute('animation__snap'); } catch (e) {}
  try {
    if (item.components && item.components['ammo-body']) {
      item.setAttribute('ammo-body', 'type', 'kinematic');
    }
  } catch (e) {}

  hand.object3D.attach(item.object3D);   // keeps world transform
  item.setAttribute('scale', '1.2 1.2 1.2');
  vrlog((item.getAttribute('item-type') || 'item') + ' GRABBED ✔');
}

function vrDetachFrom(item) {
  if (!item._held) return;
  item._held = false;
  item.sceneEl.object3D.attach(item.object3D);   // drop where released
  item.setAttribute('scale', '1 1 1');
  vrlog((item.getAttribute('item-type') || 'item') + ' released');
}

/* After a release: optional game placement. Never required for grabbing. */
function vrTryZonePlacement(item) {
  try {
    var pos = new THREE.Vector3();
    item.object3D.getWorldPosition(pos);
    var zone = vrNearest('.drop-zone', pos, VR_SNAP_RADIUS, function (el) {
      var dz = el.components && el.components['drop-zone'];
      return !(dz && dz.filled);
    });
    if (!zone) return;

    var itemType = item.getAttribute('item-type');
    var zoneType = zone.getAttribute('zone-type');
    if (itemType === zoneType && window.bakeryGame) {
      window.bakeryGame.placeItemCorrectly(item, zone);
      vrlog(itemType + ' PLACED on shelf ✨');
    } else if (itemType !== zoneType) {
      vrlog('wrong shelf for ' + itemType);
      var visual = zone.querySelector('.zone-visual');
      if (visual) {
        visual.setAttribute('material', 'color', '#ff8888');
        setTimeout(function () { visual.setAttribute('material', 'color', '#ffd0e8'); }, 450);
      }
    }
  } catch (e) { vrlog('placement error: ' + e.message); }
}

/* ─────────────────────────────────────────────
 * RAW-POSE — from grab-test, plus thumbstick events
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('raw-pose', {
  schema: { hand: { type: 'string', default: 'left' } },

  init: function () {
    this._q = new THREE.Quaternion();
    this._on = false;
    this.lastX = 0;
    this.lastY = 0;
  },

  tick: function () {
    var sceneEl = this.el.sceneEl;
    var renderer = sceneEl.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) return;
    var session = renderer.xr.getSession();
    var frame = sceneEl.frame;
    var ref = renderer.xr.getReferenceSpace();
    if (!session || !frame || !ref) return;

    for (var i = 0; i < session.inputSources.length; i++) {
      var s = session.inputSources[i];
      if (s.handedness !== this.data.hand) continue;

      if (s.gripSpace) {
        var pose = frame.getPose(s.gripSpace, ref);
        if (pose) {
          var p = pose.transform.position, o = pose.transform.orientation;
          this.el.object3D.position.set(p.x, p.y, p.z);
          this._q.set(o.x, o.y, o.z, o.w);
          this.el.object3D.quaternion.copy(this._q);
          if (!this._on) {
            this._on = true;
            vrlog(this.data.hand + ' pose tracking OK');
          }
        }
      }

      if (s.gamepad) {
        var gp = s.gamepad;
        var x = (gp.axes[0] || 0) + (gp.axes.length > 2 ? (gp.axes[2] || 0) : 0);
        var y = (gp.axes[1] || 0) + (gp.axes.length > 3 ? (gp.axes[3] || 0) : 0);
        if (x !== this.lastX || y !== this.lastY) {
          this.lastX = x; this.lastY = y;
          this.el.emit('thumbstickmoved', { x: x, y: y }, false);
        }
      }
      return;
    }
  },
});

/* ─────────────────────────────────────────────
 * PURPLE-GRAB (on <a-scene>) — LITERAL grab-test poll-grab, but the
 * grabbable set is every .interactable (all bakery items + purple block).
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('purple-grab', {
  init: function () {
    this._was  = { left: false, right: false };
    this._held = { left: null,  right: null  };
    this._p = new THREE.Vector3();
    vrlog('purple-grab armed');
  },

  tick: function () {
    var sceneEl = this.el;
    var renderer = sceneEl.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) return;
    var session = renderer.xr.getSession();
    if (!session) return;

    for (var i = 0; i < session.inputSources.length; i++) {
      var s = session.inputSources[i];
      if (!s.gamepad || !s.handedness || s.handedness === 'none') continue;
      var hand = s.handedness;
      var ent = vrHandEntity(hand);
      if (!ent) continue;

      var pressed = false;
      for (var b = 0; b < s.gamepad.buttons.length; b++) {
        if (s.gamepad.buttons[b].pressed) { pressed = true; break; }
      }

      if (pressed && !this._was[hand]) {
        // Rising edge → grab nearest free item (grab-test mechanism)
        ent.object3D.getWorldPosition(this._p);
        vrlog('button on ' + hand);
        var item = vrNearest('.interactable', this._p, VR_GRAB_RADIUS, function (el) {
          if (el._held) return false;
          var pc = el.components && el.components.pickupable;
          return !(pc && pc.isPlaced);
        });
        if (item) {
          vrAttachTo(item, ent);
          this._held[hand] = item;
        } else {
          vrlog('nothing in reach');
        }
      } else if (!pressed && this._was[hand] && this._held[hand]) {
        // Falling edge → detach in place, then optional shelf placement
        var held = this._held[hand];
        this._held[hand] = null;
        vrDetachFrom(held);
        vrTryZonePlacement(held);
      }

      this._was[hand] = pressed;
    }
  },
});

/* ─────────────────────────────────────────────
 * SMOOTH LOCOMOTION (left thumbstick)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('thumbstick-locomotion', {
  schema: {
    speed:    { type: 'number', default: 2.2 },
    deadzone: { type: 'number', default: 0.15 },
  },

  init: function () {
    this.axisX = 0;
    this.axisY = 0;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = function (evt) {
      var x = evt.detail.x || 0;
      var y = evt.detail.y || 0;
      this.axisX = Math.abs(x) < this.data.deadzone ? 0 : x;
      this.axisY = Math.abs(y) < this.data.deadzone ? 0 : y;
    }.bind(this);
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);

    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move  = new THREE.Vector3();
    this._up    = new THREE.Vector3(0, 1, 0);
  },

  tick: function (time, delta) {
    if (!this.axisX && !this.axisY) return;
    if (!this.rig || !this.head) return;
    if (!this.el.sceneEl.is('vr-mode')) return;

    var dt = Math.min(delta, 50) / 1000;

    this.head.object3D.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    this._fwd.multiplyScalar(-1).normalize();
    this._right.crossVectors(this._fwd, this._up).normalize();

    this._move.set(0, 0, 0)
      .addScaledVector(this._fwd,  -this.axisY)
      .addScaledVector(this._right, this.axisX);

    if (this._move.lengthSq() > 1) this._move.normalize();
    this._move.multiplyScalar(this.data.speed * dt);

    this.rig.object3D.position.add(this._move);
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * SNAP TURN (right thumbstick, 45° increments)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('snap-turn', {
  schema: {
    degrees:   { type: 'number', default: 45 },
    threshold: { type: 'number', default: 0.75 },
    resetAt:   { type: 'number', default: 0.35 },
  },

  init: function () {
    this.armed = true;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = function (evt) {
      var x = evt.detail.x || 0;
      if (Math.abs(x) < this.data.resetAt) { this.armed = true; return; }
      if (!this.armed || Math.abs(x) < this.data.threshold) return;
      this.armed = false;
      var dir = x > 0 ? -1 : 1;
      this.turn(dir * this.data.degrees);
    }.bind(this);
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);
  },

  turn: function (degrees) {
    if (!this.rig || !this.head) return;
    var rad = THREE.MathUtils.degToRad(degrees);
    var headWorld = new THREE.Vector3();
    this.head.object3D.getWorldPosition(headWorld);

    var rigObj = this.rig.object3D;
    rigObj.rotation.y += rad;

    var newHeadWorld = new THREE.Vector3();
    rigObj.updateMatrixWorld(true);
    this.head.object3D.getWorldPosition(newHeadWorld);
    rigObj.position.add(headWorld.sub(newHeadWorld));
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * DESKTOP ↔ VR MODE MANAGER (on <a-scene>)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-mode-manager', {
  init: function () {
    var scene = this.el;

    scene.addEventListener('enter-vr', function () {
      var cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'false');
        cursor.setAttribute('raycaster', 'enabled', false);
      }
      document.body.classList.add('in-vr');
      vrlog('entered VR — try the purple block');
    });

    scene.addEventListener('exit-vr', function () {
      var cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'true');
        cursor.setAttribute('raycaster', 'enabled', true);
      }
      document.body.classList.remove('in-vr');
      console.log('[vr.js] Exited VR');
    });
  },
});
