/**
 * 🍰 Kawaii Bakery — VR Support (v5 — raw WebXR pose + squeeze events)
 * vr.js
 *
 * Why v5: on some Quest sessions, A-Frame's laser-controls/tracked-controls
 * fails to bind the controller profile. Symptoms: a "ghost" pair of
 * controller models frozen at the rig origin, buttons visually acknowledged
 * but no grab events, proximity grabbing measuring from the wrong place.
 *
 * v5 removes the dependency on A-Frame's profile matching entirely:
 *
 *  1. POSE: xr-gamepad reads each controller's gripSpace pose straight from
 *     the raw WebXR frame every tick and drives the entity transform itself.
 *     The hand entities (models + lasers) are ALWAYS glued to your physical
 *     controllers — no more ghost pair at origin.
 *
 *  2. GRAB: raw WebXR session squeezestart/squeezeend events (guaranteed by
 *     the spec on Quest) are the primary grab input, routed per-hand. The
 *     A-Frame gripdown/gripup path remains as a deduped fallback.
 *
 *  3. TRIGGER: raw session selectstart is routed to a laser click too, so
 *     trigger pick-up/place works even if A-Frame's mapping is dead.
 *
 * Note: there is only ONE controller framework in this project — A-Frame on
 * top of WebXR. The "device level" button highlight is A-Frame's controller
 * model reacting; these fixes bypass its unreliable binding layer.
 */

var VR_GRAB_RADIUS = 0.40;  // metres — controller-to-item grab reach
var VR_SNAP_RADIUS = 0.45;  // metres — item-to-zone snap distance on release

/* ─────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────── */
function vrNearestByClass(className, worldPos, maxDist, filterFn) {
  var els = document.querySelectorAll('.' + className);
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

/* ─────────────────────────────────────────────
 * XR-GAMEPAD — raw WebXR pose driver + input poller
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('xr-gamepad', {
  schema: { hand: { type: 'string', default: 'left' } },

  init: function () {
    this.gripPressed = false;
    this.triggerPressed = false;
    this.lastX = 0;
    this.lastY = 0;
    this._logged = false;
    this._nativeGrip = false;
    this._nativeTrigger = false;
    this._poseDriven = false;
    this._q = new THREE.Quaternion();

    var self = this;
    this.el.addEventListener('gripdown', function (e) {
      if (!e.detail || e.detail._xrgp !== true) self._nativeGrip = true;
    });
    this.el.addEventListener('triggerdown', function (e) {
      if (!e.detail || e.detail._xrgp !== true) self._nativeTrigger = true;
    });

    this.el.addEventListener('controllerconnected', function () {
      setTimeout(function () {
        self.el.setAttribute('raycaster', 'objects', '.interactable, .drop-zone, .vr-ui');
      }, 100);
    });
  },

  tick: function () {
    var sceneEl = this.el.sceneEl;
    var renderer = sceneEl.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) return;
    var session = renderer.xr.getSession();
    if (!session) return;

    var source = null;
    for (var i = 0; i < session.inputSources.length; i++) {
      if (session.inputSources[i].handedness === this.data.hand) {
        source = session.inputSources[i];
        break;
      }
    }
    if (!source) return;

    /* ── DRIVE POSE DIRECTLY FROM THE XR FRAME ─────────────────────
     * A-Frame exposes the current XRFrame at sceneEl.frame during the
     * render loop. The gripSpace pose is expressed in the reference space,
     * which corresponds to the rig's local space (these hand entities are
     * children of #player), so it can be written straight into the entity
     * transform. This overrides tracked-controls whether or not it bound. */
    var frame = sceneEl.frame;
    var refSpace = renderer.xr.getReferenceSpace();
    if (frame && refSpace && source.gripSpace) {
      var pose = frame.getPose(source.gripSpace, refSpace);
      if (pose) {
        var p = pose.transform.position;
        var o = pose.transform.orientation;
        this.el.object3D.position.set(p.x, p.y, p.z);
        this._q.set(o.x, o.y, o.z, o.w);
        this.el.object3D.quaternion.copy(this._q);
        this.el.object3D.visible = true;
        if (!this._poseDriven) {
          this._poseDriven = true;
          console.log('[xr-gamepad] ' + this.data.hand + ' pose driven from raw WebXR gripSpace');
        }
      }
    }

    if (!source.gamepad) return;
    var gp = source.gamepad;

    if (!this._logged) {
      this._logged = true;
      console.log('[xr-gamepad] ' + this.data.hand + ' — axes:' + gp.axes.length +
        ' buttons:' + gp.buttons.length + ' profiles:', source.profiles);
    }

    // Thumbstick — xr-standard puts it at [2,3]; some layouts use [0,1].
    var axisX = (gp.axes[0] || 0) + (gp.axes.length > 2 ? (gp.axes[2] || 0) : 0);
    var axisY = (gp.axes[1] || 0) + (gp.axes.length > 3 ? (gp.axes[3] || 0) : 0);
    if (axisX !== this.lastX || axisY !== this.lastY) {
      this.lastX = axisX; this.lastY = axisY;
      this.el.emit('thumbstickmoved', { x: axisX, y: axisY }, false);
    }

    // Grip fallback (session squeezestart is the primary path — see
    // vr-session-input). vr-grab's `grabbing` guard dedupes overlap.
    var gripBtn = gp.buttons[1];
    if (gripBtn && !this._nativeGrip) {
      if (gripBtn.pressed && !this.gripPressed) {
        this.gripPressed = true;
        this.el.emit('gripdown', { _xrgp: true }, false);
      } else if (!gripBtn.pressed && this.gripPressed) {
        this.gripPressed = false;
        this.el.emit('gripup', { _xrgp: true }, false);
      }
    }

    // Trigger fallback
    var trigBtn = gp.buttons[0];
    if (trigBtn && !this._nativeTrigger) {
      if (trigBtn.pressed && !this.triggerPressed) {
        this.triggerPressed = true;
        this.el.emit('triggerdown', { _xrgp: true }, false);
      } else if (!trigBtn.pressed && this.triggerPressed) {
        this.triggerPressed = false;
        this.el.emit('triggerup', { _xrgp: true }, false);
      }
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
 * GRIP GRAB + PROXIMITY SNAP + THROW
 * Primary input: raw WebXR session squeezestart/squeezeend
 * Fallback:      A-Frame gripdown/gripup on the entity
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-grab', {
  init: function () {
    this.grabbing = false;
    this._ctrlPos = new THREE.Vector3();
    this._itemPos = new THREE.Vector3();

    this.grab = function () {
      if (this.grabbing) return; // dedupes session event + A-Frame fallback
      var game = window.bakeryGame;
      if (!game) return;

      // Proximity first (natural reach-and-grab)…
      this.el.object3D.getWorldPosition(this._ctrlPos);
      var target = vrNearestByClass('interactable', this._ctrlPos, VR_GRAB_RADIUS,
        function (el) {
          var pc = el.components && el.components.pickupable;
          return !(pc && pc.isPlaced);
        });

      // …then laser raycast fallback for distant items.
      if (!target) target = this.raycastTarget('interactable');

      if (target) {
        game.pickUpItem(target, this.el);
        this.grabbing = true;
      }
    }.bind(this);

    this.release = function () {
      if (!this.grabbing) return;
      this.grabbing = false;
      var game = window.bakeryGame;
      if (!game || !game.heldItem || game.holder !== this.el) return;

      // Zone nearest to the ITEM ("hover over shelf and let go").
      game.heldItem.object3D.getWorldPosition(this._itemPos);
      var zone = vrNearestByClass('drop-zone', this._itemPos, VR_SNAP_RADIUS,
        function (el) {
          var dz = el.components && el.components['drop-zone'];
          return !(dz && dz.filled);
        });

      if (!zone) zone = this.raycastTarget('drop-zone');

      if (zone) {
        game.tryPlace(zone);
        if (!game.heldItem) return; // placed successfully
      }
      game.releaseHeldWithPhysics();
    }.bind(this);

    // A-Frame-mapped fallback path
    this.el.addEventListener('gripdown', this.grab);
    this.el.addEventListener('gripup', this.release);
  },

  raycastTarget: function (className) {
    var rc = this.el.components.raycaster;
    if (!rc) return null;
    var els = rc.intersectedEls || [];
    for (var i = 0; i < els.length; i++) {
      var node = els[i];
      while (node && node !== this.el.sceneEl) {
        if (node.classList && node.classList.contains(className)) return node;
        node = node.parentElement;
      }
    }
    return null;
  },

  remove: function () {
    this.el.removeEventListener('gripdown', this.grab);
    this.el.removeEventListener('gripup', this.release);
  },
});

/* ─────────────────────────────────────────────
 * VR SESSION INPUT (on <a-scene>) — raw WebXR event routing
 *
 * squeezestart/squeezeend → the matching hand's vr-grab.grab()/release()
 * selectstart             → laser click on the hand's raycast target
 * All of these also unlock/start audio (a controller press inside the XR
 * session is the most reliable "user gesture" on Quest).
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-session-input', {
  init: function () {
    var sceneEl = this.el;

    function grabComp(handedness) {
      var ent = vrHandEntity(handedness);
      return ent && ent.components['vr-grab'];
    }

    function bind(session) {
      session.addEventListener('squeezestart', function (e) {
        if (window.bakeryAudio) window.bakeryAudio.start();
        var g = grabComp(e.inputSource.handedness);
        if (g) g.grab();
      });
      session.addEventListener('squeezeend', function (e) {
        var g = grabComp(e.inputSource.handedness);
        if (g) g.release();
      });
      session.addEventListener('selectstart', function (e) {
        if (window.bakeryAudio) window.bakeryAudio.start();
        var ent = vrHandEntity(e.inputSource.handedness);
        if (!ent) return;
        var vg = ent.components['vr-grab'];
        if (!vg) return;
        // Audio-start panel takes priority if the laser is on it.
        var ui = vg.raycastTarget('vr-ui');
        if (ui) { ui.emit('click', { cursorEl: ent }, false); return; }
        // Direct trigger pick/place fallback. Safe alongside laser-controls'
        // own click mapping: pickUpItem/tryPlace are idempotent.
        var item = vg.raycastTarget('interactable');
        if (item && window.bakeryGame) { window.bakeryGame.pickUpItem(item, ent); return; }
        var zone = vg.raycastTarget('drop-zone');
        if (zone && window.bakeryGame) { window.bakeryGame.tryPlace(zone); }
      });
      console.log('[vr.js] raw WebXR session input bound (squeeze + select)');
    }

    sceneEl.addEventListener('enter-vr', function () {
      var xr = sceneEl.renderer && sceneEl.renderer.xr;
      var session = xr && xr.getSession && xr.getSession();
      if (session) bind(session);
    });
  },
});

/* ─────────────────────────────────────────────
 * AUDIO START PANEL — clickable in-VR "▶ Start" plane
 * Click it with the laser (trigger) to start audio. It also auto-dismisses
 * as soon as audio starts by any other route (squeeze, desktop click, …).
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('audio-start-panel', {
  init: function () {
    var el = this.el;
    var done = false;
    var activate = function () {
      if (done) return;
      done = true;
      if (window.bakeryAudio) window.bakeryAudio.start();
      el.setAttribute('animation__out', {
        property: 'scale', to: '0.001 0.001 0.001', dur: 250, easing: 'easeInBack'
      });
      setTimeout(function () { el.setAttribute('visible', 'false'); }, 300);
    };
    el.addEventListener('click', activate);
    var check = setInterval(function () {
      if (window.bakeryAudio && window.bakeryAudio.started) {
        clearInterval(check);
        activate();
      }
    }, 500);
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
      if (window.bakeryAudio) window.bakeryAudio.start();
      console.log('[vr.js] Entered VR');
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
