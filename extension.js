/* per-app-volume */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Shell from 'gi://Shell';
import St from 'gi://St';

const IGNORED_APP_IDS = [
    'org.gnome.VolumeControl',
    'org.PulseAudio.pavucontrol',
];

const IGNORED_STREAM_PATTERNS = [

    'easyeffects',
    'effect_output',
    'effect_input',
    'jamesdsp',
    'pulseeffects',
    'filter-chain',
    'soft eq',

    'speech-dispatcher',
    'speechd',
    'sd_dummy',
    'sd-dummy',
    'espeak',
    'festival',

    'echo-cancel',
    'echocancel',
    'noise',
    'rnnoise',
    'peak detect',
    'peakdetect',

    'gnome-shell',
    'gsound',
    'libcanberra',
    'canberra',
    'xdg-desktop-portal',
    'pipewire',
    'wireplumber',
    'pulseaudio',
    'alsa-',
];

const IGNORED_BINARIES = [
    'sd_dummy',
    'speech-dispatcher',
    'speechd',
    'espeak-ng',
];

const IGNORED_APP_NAMES_EXACT = [
    'speech-dispatcher-dummy',
    'speech-dispatcher',
    'pipewire',
    'wireplumber',
    'xdg-desktop-portal',
    'gnome-shell',
];

function streamFlag(stream, jsProp) {
    try {
        const v = stream[jsProp];
        if (typeof v === 'function')
            return !!v.call(stream);
        return !!v;
    } catch {
        return false;
    }
}

function prettifyStreamName(raw) {
    if (!raw)
        return '';
    let s = raw.trim().replace(/\.exe$/i, '');

    if (/^audio[ _-]?stream( #\d+)?$/i.test(s))
        return '';
    s = s.replace(/[_\-.]+/g, ' ');
    s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    s = s.replace(/\s+/g, ' ').trim();

    if (s && s === s.toLowerCase())
        s = s.replace(/\b\w/g, c => c.toUpperCase());
    return s;
}

function parsePortalIndex(pactlList) {
    const byExact = new Map();
    const byAppName = new Map();
    const propsByExact = new Map();
    const propsByNode = new Map();
    try {
        for (const entry of pactlList) {
            const p = entry.properties ?? {};
            const appName = (p['application.name'] ?? '').trim();
            const mediaName = (p['media.name'] ?? '').trim();
            const nodeName = (p['node.name'] ?? '').trim();
            const portalId = (p['pipewire.access.portal.app_id'] ?? '').trim();

            if (portalId && appName) {
                byAppName.set(appName.toLowerCase(), portalId);
                if (mediaName)
                    byExact.set(`${appName.toLowerCase()}\n${mediaName.toLowerCase()}`, portalId);
            }

            if (appName && mediaName)
                propsByExact.set(`${appName.toLowerCase()}\n${mediaName.toLowerCase()}`, p);
            else if (mediaName)
                propsByExact.set(`\n${mediaName.toLowerCase()}`, p);
            if (nodeName)
                propsByNode.set(nodeName.toLowerCase(), p);
            if (appName && !byAppName.has(`__props__${appName.toLowerCase()}`))
                byAppName.set(`__props__${appName.toLowerCase()}`, p);
        }
    } catch {

    }
    return { byExact, byAppName, propsByExact, propsByNode };
}

function getPortalIndexSync() {

    const empty = { byExact: new Map(), byAppName: new Map(), propsByExact: new Map(), propsByNode: new Map() };
    try {
        const [ok, stdout] = GLib.spawn_command_line_sync('pactl -f json list sink-inputs');
        if (!ok || !stdout)
            return empty;
        const list = JSON.parse(new TextDecoder().decode(stdout));
        return parsePortalIndex(list);
    } catch {
        return empty;
    }
}

function pactlPropsForStream(stream, index) {
    try {
        const sname = (stream.get_name?.() ?? '').trim().toLowerCase();
        const desc = (stream.get_description?.() ?? '').trim().toLowerCase();
        if (sname && desc) {
            const hit = index.propsByExact.get(`${sname}\n${desc}`);
            if (hit)
                return hit;
        }
        if (desc) {
            const hit = index.propsByExact.get(`\n${desc}`);
            if (hit)
                return hit;
        }
        if (sname) {
            const hit = index.propsByNode.get(sname)
                ?? index.byAppName.get(`__props__${sname}`);
            if (hit)
                return hit;
        }
    } catch {

    }
    return null;
}

function shouldHideByPactl(props) {
    if (!props)
        return false;

    if (props['node.virtual'] === 'true' || props['node.passive'] === 'true')
        return true;
    const appName = (props['application.name'] ?? '').trim().toLowerCase();
    const nodeName = (props['node.name'] ?? '').trim().toLowerCase();
    const binary = (props['application.process.binary'] ?? '').trim().toLowerCase();
    if (appName && IGNORED_APP_NAMES_EXACT.includes(appName))
        return true;
    if (nodeName && IGNORED_APP_NAMES_EXACT.includes(nodeName))
        return true;
    if (binary && IGNORED_BINARIES.some(b => binary === b || binary.includes(b)))
        return true;
    const haystack = [appName, nodeName, props['media.name'] ?? '', props['device.description'] ?? '']
        .join('\n').toLowerCase();
    if (IGNORED_STREAM_PATTERNS.some(p => haystack.includes(p)))
        return true;

    if (!appName && !props['client.api'])
        return true;
    return false;
}

function portalIdForStream(stream, index) {
    try {
        const sname = (stream.get_name?.() ?? '').trim().toLowerCase();
        const desc = (stream.get_description?.() ?? '').trim().toLowerCase();
        if (sname && desc) {
            const hit = index.byExact.get(`${sname}\n${desc}`);
            if (hit)
                return hit;
        }
        if (sname) {
            const hit = index.byAppName.get(sname);
            if (hit)
                return hit;
        }
    } catch {

    }
    return '';
}

const StreamRow = GObject.registerClass(
    class StreamRow extends PopupMenu.PopupBaseMenuItem {
        _init(control, streams, maxNorm) {
            super._init({ reactive: false });
            this._control = control;
            this._streams = Array.isArray(streams) ? streams : [streams];
            this._stream = this._streams[0];
            this._maxNorm = maxNorm;
            this._updating = false;
            this._signals = [];
            this._portalApplied = false;

            const vbox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: 'pav-row',
            });

            const top = new St.BoxLayout({ x_expand: true });
            vbox.add_child(top);

            this._icon = new St.Icon({
                style_class: 'pav-app-icon',
                icon_size: 22,
            });
            this._icon.set_gicon(this._resolveIcon());
            top.add_child(this._icon);

            this._nameLabel = new St.Label({
                text: this._resolveName(),
                x_expand: true,
                style_class: 'pav-app-name',
            });
            top.add_child(this._nameLabel);

            this._pctLabel = new St.Label({ style_class: 'pav-pct' });
            top.add_child(this._pctLabel);

            this._muteBtn = new St.Button({
                style_class: 'pav-mute-btn',
                can_focus: true,
                x_align: Clutter.ActorAlign.END,
            });
            this._muteIcon = new St.Icon({ icon_size: 16 });
            this._muteBtn.set_child(this._muteIcon);
            this._muteBtn.connect('clicked', () => {

                const anyUnmuted = this._streams.some(s => {
                    try {
                        return !s.get_is_muted();
                    } catch {
                        return false;
                    }
                });
                for (const s of this._streams) {
                    try {
                        s.change_is_muted(anyUnmuted);
                    } catch {

                    }
                }
            });
            top.add_child(this._muteBtn);

            this._slider = new Slider.Slider(this._getSliderValue());

            this._slider.add_style_class_name('pav-slider');
            this._slider.connect('notify::value', () => this._onSliderChanged());
            vbox.add_child(this._slider);

            this.add_child(vbox);

            for (const s of this._streams) {
                try {
                    this._signals.push(
                        { stream: s, id: s.connect('notify::volume', () => this._sync()) },
                        { stream: s, id: s.connect('notify::is-muted', () => this._sync()) }
                    );
                } catch {

                }
            }
            this._sync();
        }

        get stream() {
            return this._stream;
        }

        get streams() {
            return this._streams;
        }

        _getSliderValue() {
            try {
                return Math.min(1, this._stream.get_volume() / this._maxNorm);
            } catch {
                return 0;
            }
        }

        _onSliderChanged() {
            if (this._updating)
                return;
            const vol = Math.round(this._slider.value * this._maxNorm);
            for (const s of this._streams) {
                try {
                    s.set_volume(vol);
                    s.push_volume();

                    if (vol > 0 && s.get_is_muted())
                        s.change_is_muted(false);
                } catch {

                }
            }
            this._syncLabel();
        }

        _sync() {
            this._updating = true;
            try {
                this._slider.value = this._getSliderValue();
            } finally {
                this._updating = false;
            }
            this._syncLabel();
        }

        _syncLabel() {
            let muted = false;
            try {

                muted = this._streams.every(s => {
                    try {
                        return s.get_is_muted();
                    } catch {
                        return true;
                    }
                });
            } catch {
                muted = false;
            }
            const pct = Math.round(this._slider.value * 100);
            this._pctLabel.set_text(muted ? 'Sessiz' : `%${pct}`);
            this._muteIcon.set_icon_name(
                muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic'
            );
            this._muteBtn.set_opacity(muted ? 255 : 160);
        }

        applyPortalApp(portalAppId) {
            if (this._portalApplied || !portalAppId)
                return;
            try {
                const sys = Shell.AppSystem.get_default();
                const portalApp = sys.lookup_app(portalAppId)
                    ?? sys.lookup_app(`${portalAppId}.desktop`);
                if (!portalApp)
                    return;
                this._portalApplied = true;
                const raw = (this._stream.get_name?.() ?? '').trim();
                const pretty = prettifyStreamName(raw);

                this._nameLabel.set_text(pretty || portalApp.get_name());
                if (portalApp.get_icon())
                    this._icon.set_gicon(portalApp.get_icon());
            } catch {

            }
        }

        _resolveName() {

            const app = this._lookupApp();
            if (app)
                return app.get_name();
            const name = this._stream.get_name?.() ?? '';

            const pretty = prettifyStreamName(name);
            if (pretty)
                return pretty;
            const desc = this._stream.get_description?.() ?? '';

            return name || desc || 'Bilinmeyen uygulama';
        }

        _resolveIcon() {

            const app = this._lookupApp();
            if (app?.get_icon())
                return app.get_icon();
            const iconName = this._stream.get_icon_name?.();
            if (iconName && !iconName.startsWith('application-x-executable'))
                return new Gio.ThemedIcon({ name: iconName });
            return new Gio.ThemedIcon({ name: 'application-x-executable-symbolic' });
        }

        _lookupApp() {
            try {
                const sys = Shell.AppSystem.get_default();

                const appId = this._stream.get_application_id?.();
                if (appId) {
                    const direct = sys.lookup_app(appId)
                        ?? sys.lookup_app(`${appId}.desktop`);
                    if (direct)
                        return direct;
                }

                const rawName = (this._stream.get_name?.() ?? '').trim();
                if (!rawName)
                    return null;
                const candidates = new Set([
                    rawName.toLowerCase(),
                    rawName.replace(/\.exe$/i, '').toLowerCase(),
                    prettifyStreamName(rawName).toLowerCase(),
                ]);
                candidates.delete('');
                if (candidates.size === 0)
                    return null;
                for (const a of sys.get_installed()) {
                    const aname = (a.get_name() ?? '').toLowerCase();
                    if (aname && candidates.has(aname))
                        return a;
                    const aid = (a.get_id() ?? '').toLowerCase().replace(/\.desktop$/, '');
                    if (!aid || aid.length < 3)
                        continue;
                    for (const c of candidates) {
                        if (c.length >= 3 && (aid === c || aid.includes(c)))
                            return a;
                    }
                }
                return null;
            } catch {
                return null;
            }
        }

        destroy() {
            for (const { stream, id } of this._signals) {
                try {
                    stream.disconnect(id);
                } catch {

                }
            }
            this._signals = [];
            this._streams = [];
            super.destroy();
        }
    }
);

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'Uygulama Sesleri');

            const hbox = new St.BoxLayout();
            this._icon = new St.Icon({
                icon_name: 'audio-volume-medium-symbolic',
                style_class: 'system-status-icon',
            });
            hbox.add_child(this._icon);
            this._countLabel = new St.Label({
                text: '',
                style_class: 'pav-count',
                y_align: Clutter.ActorAlign.CENTER,
            });
            hbox.add_child(this._countLabel);
            this.add_child(hbox);

            const header = new PopupMenu.PopupMenuItem('Uygulama Sesleri', {
                reactive: false,
            });
            header.add_style_class_name('pav-header');
            this.menu.addMenuItem(header);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._masterBox = new PopupMenu.PopupBaseMenuItem({ reactive: false });
            this._masterSink = null;
            this._masterSignals = [];
            this.menu.addMenuItem(this._masterBox);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._section = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._section);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const refresh = new PopupMenu.PopupMenuItem('Listeyi yenile');
            refresh.connect('activate', () => this._rebuild());
            this.menu.addMenuItem(refresh);

            const settings = new PopupMenu.PopupMenuItem('Ses ayarlarını aç');
            settings.connect('activate', () => openSoundSettings());
            this.menu.addMenuItem(settings);

            this._rows = [];
            this._controlSignals = [];
            this._rebuildToken = 0;

            this._control = new Gvc.MixerControl({ name: 'Uygulama Ses Karıştırıcısı' });
            this._controlSignals.push(
                this._control.connect('state-changed', () => this._rebuild()),
                this._control.connect('stream-added', () => this._rebuild()),
                this._control.connect('stream-removed', () => this._rebuild())
            );
            this._control.open();

            this.menu.connect('open-state-changed', (menu, open) => {
                if (open)
                    this._rebuild();
            });
            this._rebuild();
        }

        _isUsableStream(stream) {
            if (streamFlag(stream, 'is_event_stream'))
                return false;
            const appId = stream.get_application_id?.() ?? '';
            const sname = (stream.get_name?.() ?? '').trim();
            const desc = stream.get_description?.() ?? '';

            if (!appId && !sname)
                return false;
            if (IGNORED_APP_IDS.includes(appId))
                return false;
            const snameLower = sname.toLowerCase();
            if (snameLower && IGNORED_APP_NAMES_EXACT.includes(snameLower))
                return false;
            const haystack = [
                appId,
                sname,
                desc,
            ].join('\n').toLowerCase();
            if (IGNORED_STREAM_PATTERNS.some(p => haystack.includes(p)))
                return false;
            return true;
        }

        _rebuild() {
            const token = ++this._rebuildToken;

            for (const row of this._rows)
                row.destroy();
            this._rows = [];

            if (!this._control) {
                this._showEmpty('Ses servisi başlatılamadı');
                return;
            }

            const maxNorm = this._control.get_vol_max_norm();
            let streams = [];
            try {
                streams = this._control.get_sink_inputs() ?? [];
            } catch {
                streams = [];
            }

            streams = streams.filter(s => this._isUsableStream(s));

            let pactlIndex = null;
            try {
                pactlIndex = getPortalIndexSync();
                streams = streams.filter(s => {
                    try {
                        return !shouldHideByPactl(pactlPropsForStream(s, pactlIndex));
                    } catch {
                        return true;
                    }
                });
            } catch {
                pactlIndex = null;
            }

            this._buildMasterRow(maxNorm);

            if (streams.length === 0) {
                this._showEmpty('Şu an ses çalan uygulama yok');
            } else {

                const groups = new Map();
                for (const s of streams) {
                    let appId = '';
                    let sname = '';
                    try {
                        appId = (s.get_application_id?.() ?? '').trim().toLowerCase();
                        sname = (s.get_name?.() ?? '').trim().toLowerCase();
                    } catch {

                    }
                    const key = `${appId}|${sname}`;
                    if (!groups.has(key))
                        groups.set(key, []);
                    groups.get(key).push(s);
                }
                for (const groupStreams of groups.values()) {
                    const row = new StreamRow(this._control, groupStreams, maxNorm);
                    this._rows.push(row);
                    this._section.addMenuItem(row);
                }

                try {
                    const index = pactlIndex ?? getPortalIndexSync();
                    for (const row of this._rows) {
                        try {
                            const first = row.streams?.[0];
                            if (!first)
                                continue;
                            row.applyPortalApp(portalIdForStream(first, index));
                        } catch {

                        }
                    }
                } catch {

                }
            }

            const groupCount = this._rows.length;

            const hasApps = streams.length > 0;
            this._countLabel.set_text(hasApps ? `${groupCount}` : '');
            this._icon.set_icon_name(
                hasApps
                    ? 'audio-volume-medium-symbolic'
                    : 'audio-volume-muted-symbolic'
            );
        }

        _buildMasterRow(maxNorm) {

            for (const c of this._masterBox.get_children())
                c.destroy();

            if (this._masterSink) {
                for (const id of this._masterSignals) {
                    try {
                        this._masterSink.disconnect(id);
                    } catch {  }
                }
            }
            this._masterSignals = [];
            this._masterSink = null;

            let sink = null;
            try {
                sink = this._control.get_default_sink();
            } catch {
                sink = null;
            }
            if (!sink) {
                const l = new St.Label({ text: 'Çıkış aygıtı bulunamadı' });
                this._masterBox.add_child(l);
                return;
            }

            const vbox = new St.BoxLayout({ vertical: true, x_expand: true });
            const top = new St.BoxLayout({ x_expand: true });
            const icon = new St.Icon({
                icon_name: 'audio-speakers-symbolic',
                icon_size: 22,
                style_class: 'pav-app-icon',
            });
            top.add_child(icon);
            const label = new St.Label({
                text: 'Sistem sesi',
                x_expand: true,
                style_class: 'pav-app-name',
            });
            top.add_child(label);
            const pct = new St.Label({ style_class: 'pav-pct' });
            top.add_child(pct);
            vbox.add_child(top);

            const slider = new Slider.Slider(
                Math.min(1, sink.get_volume() / maxNorm)
            );

            slider.add_style_class_name('pav-slider');
            let internal = false;
            slider.connect('notify::value', () => {
                if (internal)
                    return;
                const vol = Math.round(slider.value * maxNorm);
                sink.set_volume(vol);
                sink.push_volume();
                if (vol > 0 && sink.get_is_muted())
                    sink.change_is_muted(false);
                pct.set_text(`%${Math.round(slider.value * 100)}`);
            });
            const syncMaster = () => {
                internal = true;
                try {
                    slider.value = Math.min(1, sink.get_volume() / maxNorm);
                } finally {
                    internal = false;
                }
                pct.set_text(
                    sink.get_is_muted()
                        ? 'Sessiz'
                        : `%${Math.round(slider.value * 100)}`
                );
            };
            this._masterSignals.push(
                sink.connect('notify::volume', syncMaster),
                sink.connect('notify::is-muted', syncMaster)
            );
            this._masterSink = sink;
            syncMaster();
            vbox.add_child(slider);
            this._masterBox.add_child(vbox);
        }

        _showEmpty(text) {
            const item = new PopupMenu.PopupMenuItem(text, { reactive: false });
            item.add_style_class_name('pav-empty');
            this._rows.push(item);
            this._section.addMenuItem(item);
        }

        destroy() {
            this._rebuildToken++;
            for (const id of this._controlSignals) {
                try {
                    this._control.disconnect(id);
                } catch {  }
            }
            this._controlSignals = [];
            if (this._masterSink) {
                for (const id of this._masterSignals) {
                    try {
                        this._masterSink.disconnect(id);
                    } catch {  }
                }
            }
            this._masterSignals = [];
            this._masterSink = null;
            for (const row of this._rows)
                row.destroy();
            this._rows = [];
            try {
                this._control.close();
            } catch {  }
            this._control = null;
            super.destroy();
        }
    }
);

function openSoundSettings() {

    for (const argv of [['gnome-control-center', 'sound'], ['pavucontrol']]) {
        try {
            GLib.spawn_async(null, argv, null,
                GLib.SpawnFlags.SEARCH_PATH, null);
            return;
        } catch {

        }
    }
    Main.notify('Ses ayarları açılamadı');
}

export default class PerAppVolumeExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
