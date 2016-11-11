// vim: expandtab shiftwidth=4 tabstop=8 softtabstop=4 encoding=utf-8 textwidth=99
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Cinnamon Window List
// Authors:
//   Kurt Rottmann <kurtrottmann@gmail.com>
//   Jason Siefken
//   Josh hess <jake.phy@gmail.com>
// Taking code from
// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+
// http://intgat.tigress.co.uk/rmy/extensions/gnome-Cinnamon-frippery-0.2.3.tgz
/* jshint moz:true */
const Applet = imports.ui.applet
const Lang = imports.lang
const Cinnamon = imports.gi.Cinnamon
const Clutter = imports.gi.Clutter;
const St = imports.gi.St
const Main = imports.ui.main
const Signals = imports.signals
const DND = imports.ui.dnd
const Settings = imports.ui.settings
const Gettext = imports.gettext
const Gio = imports.gi.Gio
const Gtk = imports.gi.Gtk
const GLib = imports.gi.GLib

const _ = imports.applet._
const clog = imports.applet.clog

const AppletDir = imports.ui.appletManager.applets['IcingTaskManager@json']
const AppList = AppletDir.appList

const TitleDisplay = {
  None: 1,
  App: 2,
  Title: 3,
  Focused: 4
}
const NumberDisplay = {
  Smart: 1,
  Normal: 2,
  None: 3,
  All: 4
}

// Some functional programming tools

const range = function (a, b) {
  let ret = []
  // if b is unset, we want a to be the upper bound on the range
  if (b === null || b === undefined) { [a, b] = [0, a]
  }

  for (let i = a; i < b; i++) {
    ret.push(i)
  }
  return ret
}

// Connects and keeps track of signal IDs so that signals
// can be easily disconnected

function SignalTracker () {
  this._init.apply(this, arguments)
}

SignalTracker.prototype = {
  _init: function () {
    this._data = []
  },

  // params = {
  //              signalName: Signal Name
  //              callback: Callback Function
  //              bind: Context to bind to
  //              object: object to connect to
  // }
  connect: function (params) {
    let signalName = params.signalName
    let callback = params.callback
    let bind = params.bind
    let object = params.object
    let signalID = null

    signalID = object.connect(signalName, Lang.bind(bind, callback))
    this._data.push({
      signalName: signalName,
      callback: callback,
      object: object,
      signalID: signalID,
      bind: bind
    })
  },

  disconnect: function (param) {},

  disconnectAll: function () {
    for (var i = this._data.length - 1; i >= 0; i--) {
      this._data[i]
      this._data[i].object.disconnect(this._data[i].signalID)
      for (let prop in this._data[i]) {
        this._data[i][prop] = null
      }
    }
    this._data = []
  }
}

function PinnedFavs () {
  this._init.apply(this, arguments)
}

/*



MyApplet._init -> PinnedFavs



*/

PinnedFavs.prototype = {
  _init: function (applet) {
    this._applet = applet
    this.appSys = Cinnamon.AppSystem.get_default()
    this._favorites = []
    this._applet.settings.connect('changed::pinned-apps', ()=>this.emit('refreshList'))
    this._reload()
  },

  _reload: function () {
    let ids = this._applet.settings.getValue('pinned-apps')

    for (let i = 0, len = ids.length; i < len; i++) {
      var refFav = _.findIndex(this._favorites, {id: ids[i]})
      if (refFav === -1) {
        let app = this.appSys.lookup_app(ids[i])
        this._favorites.push({
          id: ids[i],
          app: app
        })
      }  
    }
  },

  _getIds: function () {
    return _.map(this._favorites, 'id')
  },

  getFavoriteMap: function () {
    return this._favorites
  },

  getFavorites: function () {
    return _.map(this._favorites, 'app')
  },

  isFavorite: function (appId) {
    var refFav = _.findIndex(this._favorites, {id: appId})
    return refFav !== -1
  },

  _addFavorite: function (appId, pos) {
    if (this.isFavorite(appId)) {
      return false
    }

    let app = this.appSys.lookup_app(appId)
    if (!app) {
      app = this.appSys.lookup_settings_app(appId)
    }


    if (!app) {
      return false
    }

    var newFav = {
      id: appId,
      app: app
    }

    this._favorites.push(newFav)

    if (pos !== -1) {
      this.moveFavoriteToPos(appId, pos)
    }

    this._applet.settings.setValue('pinned-apps', _.map(this._favorites, 'id'))
    return true
  },

  moveFavoriteToPos: function (appId, pos) {
    let oldIndex = _.findIndex(this._favorites, {id: appId})
    if (oldIndex !== -1 && pos > oldIndex) {
      pos = pos - 1
    }
    this._favorites.splice(pos, 0, this._favorites.splice(oldIndex, 1)[0])
    this._applet.settings.setValue('pinned-apps', _.map(this._favorites, 'id'))
  },

  _removeFavorite: function (appId) {
    var refFav = _.findIndex(this._favorites, {id: appId})
    if (refFav === -1) {
      return false
    }

    _.pullAt(this._favorites, refFav)
    this._applet.settings.setValue('pinned-apps', _.map(this._favorites, 'id'))
    return true
  },

  removeFavorite: function (appId) {
    this._removeFavorite(appId)
  }
}
Signals.addSignalMethods(PinnedFavs.prototype)

function appFromWMClass (appsys, specialApps, metaWindow) {
  function startup_class (wmclass) {
    let app_final = null
    for (let i = 0, len = specialApps.length; i < len; i++) {
      if (specialApps[i].wmClass == wmclass) {
        app_final = appsys.lookup_app(specialApps[i].id)
        if (!app_final) {
          app_final = appsys.lookup_settings_app(specialApps[i].id)
        }
        app_final.wmClass = wmclass
      }
    }
    return app_final
  }
  let wmClassInstance = metaWindow.get_wm_class_instance()
  let app = startup_class(wmClassInstance)
  return app
}

function MyApplet (metadata, orientation, panel_height, instance_id) {
  this._init(metadata, orientation, panel_height, instance_id)
}

MyApplet.prototype = {
  __proto__: Applet.Applet.prototype,

  _init: function (metadata, orientation, panel_height, instance_id) {
    Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id)
    this.settings = new Settings.AppletSettings(this, 'IcingTaskManager@json', instance_id)

    this.actor.set_track_hover(false)
    this.orientation = orientation
    this.appletEnabled = false;

    this.c32 = true

    /* Declare vertical panel compatibility */
    try {
      this.setAllowedLayout(Applet.AllowedLayout.BOTH);
    } catch (e) {
      this.c32 = null
      /* We are on Cinnamon < 3.2 */
    }

    try {
      this._uuid = metadata.uuid
      this.execInstallLanguage()
      Gettext.bindtextdomain(this._uuid, GLib.get_home_dir() + '/.local/share/locale')

      var settingsProps = [
        {key: 'show-pinned', value: 'showPinned'},
        {key: 'show-alerts', value: 'showAlerts'},
        {key: 'arrange-pinnedApps', value: 'arrangePinned'},
        {key: 'enable-hover-peek', value: 'enablePeek'},
        {key: 'onclick-thumbnails', value: 'onclickThumbs'},
        {key: 'hover-peek-opacity', value: 'peekOpacity'},
        {key: 'thumbnail-timeout', value: 'thumbTimeout'},
        {key: 'thumbnail-size', value: 'thumbSize'},
        {key: 'sort-thumbnails', value: 'sortThumbs'},
        {key: 'vertical-thumbnails', value: 'verticalThumbs'},
        {key: 'stack-thumbnails', value: 'stackThumbs'},
        {key: 'show-thumbnails', value: 'showThumbs'},
        {key: 'number-display', value: 'numDisplay'},
        {key: 'title-display', value: 'titleDisplay'},
        {key: 'icon-padding', value: 'iconPadding'},
        {key: 'enable-iconSize', value: 'enableIconSize'},
        {key: 'icon-size', value: 'iconSize'},
        {key: 'show-recent', value: 'showRecent'},
        {key: 'appmenu-width', value: 'appMenuWidth'},
        {key: 'firefox-menu', value: 'firefoxMenu'},
        {key: 'appmenu-number', value: 'appMenuNum'}
      ]

      if (this.c32) {
        for (let i = 0, len = settingsProps.length; i < len; i++) {
          this.settings.bind(settingsProps[i].key, settingsProps[i].value);
        }
      } else {
        for (let i = 0, len = settingsProps.length; i < len; i++) {
          var direction = settingsProps[i].value === 'pinnedApps' ? 'BIDIRECTIONAL' : 'IN'
          this.settings.bindProperty(Settings.BindingDirection[direction], settingsProps[i].key, settingsProps[i].value, null, null)
        }
      }

      this._box = new St.Bin()

      this.actor.add(this._box)

      var manager
      if (this.orientation == St.Side.TOP || this.orientation == St.Side.BOTTOM) {
        manager = new Clutter.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL })
      } else {
        manager = new Clutter.BoxLayout({ orientation: Clutter.Orientation.VERTICAL })
        this.actor.add_style_class_name('vertical')
      }

      this.manager = manager;
      this.manager_container = new Clutter.Actor({ layout_manager: manager })
      this.actor.add_actor(this.manager_container)

      this.tracker = Cinnamon.WindowTracker.get_default()

      this.pinnedAppsContr = new PinnedFavs(this)

      this.recentManager = Gtk.RecentManager.get_default()
      this.recentItems = this.recentManager.get_items().sort(function (a, b) { return a.get_modified() - b.get_modified(); }).reverse()
      this.recentManager.connect('changed', Lang.bind(this, this.on_recent_items_changed))

      this.metaWorkspaces = []

      Main.keybindingManager.addHotKey('move-app-to-next-monitor', '<Shift><Super>Right', Lang.bind(this, this._onMoveToNextMonitor))
      Main.keybindingManager.addHotKey('move-app-to-prev-monitor', '<Shift><Super>Left', Lang.bind(this, this._onMoveToPrevMonitor))

      // Use a signal tracker so we don't have to keep track of all these id's manually!

      this.signals = new SignalTracker()
      this.signals.connect({
        object: global.window_manager,
        signalName: 'switch-workspace',
        callback: this._onSwitchWorkspace,
        bind: this
      })
      this.signals.connect({
        object: global.screen,
        signalName: 'notify::n-workspaces',
        callback: this._onWorkspaceCreatedOrDestroyed,
        bind: this
      })
      this.signals.connect({
        object: Main.overview,
        signalName: 'showing',
        callback: this._onOverviewShow,
        bind: this
      })
      this.signals.connect({
        object: Main.overview,
        signalName: 'hiding',
        callback: this._onOverviewHide,
        bind: this
      })
      this.signals.connect({
        object: Main.expo,
        signalName: 'showing',
        callback: this._onOverviewShow,
        bind: this
      })
      this.signals.connect({
        object: Main.expo,
        signalName: 'hiding',
        callback: this._onOverviewHide,
        bind: this
      })

      // Query apps for the current workspace
      this._onSwitchWorkspace(null, null, global.screen.get_active_workspace_index())

      global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed))

      if (this.c32) {
        this.actor.connect('style-changed', Lang.bind(this, this._updateSpacing));
        this.settings.connect('changed::icon-padding', Lang.bind(this, this._updateSpacing))
        this.on_orientation_changed(orientation);
      } else {
        if (this.orientation === St.Side.TOP) {
          this.actor.style = 'margin-top: 0px; padding-top: 0px;'
        } else if (orientation === St.Side.BOTTOM) {
          this.actor.style = 'margin-bottom: 0px; padding-bottom: 0px;'
        }
      }
    } catch (e) {
      Main.notify('Error', e.message)
      global.logError(e)
    }
  },

  on_applet_added_to_panel: function(userEnabled) {
    if (this.c32) {
      this._updateSpacing();
      this.appletEnabled = true;
    }
  },

  on_orientation_changed: function(orientation) {
    this.orientation = orientation

    if (orientation == St.Side.TOP || orientation == St.Side.BOTTOM) {
      this.manager.set_vertical(false);
      this.actor.remove_style_class_name('vertical');
    } else {
      this.manager.set_vertical(true);
      this.actor.add_style_class_name('vertical');
      this.actor.set_x_align(Clutter.ActorAlign.CENTER);
      this.actor.set_important(true);
    }

    // Any padding/margin is removed on one side so that the AppMenuButton
    // boxes butt up against the edge of the screen

    var containerChildren = this.manager_container.get_children()

    _.each(containerChildren, (child, key)=>{
      if (orientation === St.Side.TOP) {
        child.set_style('margin-top: 0px; padding-top: 0px;')
        this.actor.set_style('margin-top: 0px; padding-top: 0px;')
      } else if (orientation === St.Side.BOTTOM) {
        child.set_style('margin-bottom: 0px; padding-bottom: 0px;')
        this.actor.set_style('margin-bottom: 0px; padding-bottom: 0px;')
      } else if (orientation === St.Side.LEFT) {
        child.set_style('margin-left 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;')
        child.set_x_align(Clutter.ActorAlign.CENTER)
        this.actor.set_style('margin-left: 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;')
      } else if (orientation === St.Side.RIGHT) {
        child.set_style('margin-left: 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;')
        child.set_x_align(Clutter.ActorAlign.CENTER)
        this.actor.set_style('margin-right: 0px; padding-right: 0px; padding-left: 0px; margin-left: 0px;')
      }
    })
    if (this.appletEnabled) {
      this._updateSpacing()
    }
  },

  _updateSpacing: function() {
    this.manager.set_spacing(this.iconPadding * global.ui_scale)
  },

  execInstallLanguage: function () {
    try {
      let _shareFolder = GLib.get_home_dir() + '/.local/share/'
      let _localeFolder = Gio.file_new_for_path(_shareFolder + 'locale/')
      let _moFolder = Gio.file_new_for_path(_shareFolder + 'cinnamon/applets/' + this._uuid + '/locale/mo/')
      let children = _moFolder.enumerate_children('standard::name,standard::type,time::modified',
        Gio.FileQueryInfoFlags.NONE, null)
      let info, _moFile, _moLocale, _moPath, _src, _dest, _modified, _destModified
      while ((info = children.next_file(null)) !== null) {
        _modified = info.get_modification_time().tv_sec
        if (info.get_file_type() == Gio.FileType.REGULAR) {
          _moFile = info.get_name()
          if (_moFile.substring(_moFile.lastIndexOf('.')) == '.mo') {
            _moLocale = _moFile.substring(0, _moFile.lastIndexOf('.'))
            _moPath = _localeFolder.get_path() + '/' + _moLocale + '/LC_MESSAGES/'
            _src = Gio.file_new_for_path(String(_moFolder.get_path() + '/' + _moFile))
            _dest = Gio.file_new_for_path(String(_moPath + this._uuid + '.mo'))
            try {
              if (_dest.query_exists(null)) {
                _destModified = _dest.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null).get_modification_time().tv_sec
                if( (_modified > _destModified)) {
                  _src.copy(_dest, Gio.FileCopyFlags.OVERWRITE, null, null)
                }
              } else {
                this._makeDirectoy(_dest.get_parent())
                _src.copy(_dest, Gio.FileCopyFlags.OVERWRITE, null, null)
              }
            } catch(e) {
              Main.notify('Error', e.message)
              global.logError(e)
            }
          }
        }
      }
    } catch (e) {
      Main.notify('Error', e.message)
      global.logError(e)
    }


  },

  _makeDirectoy: function (fDir) {
    if (!this._isDirectory(fDir)) {
      this._makeDirectoy(fDir.get_parent())
    }
    if (!this._isDirectory(fDir)) {
      fDir.make_directory(null)
    }
  },

  _isDirectory: function (fDir) {
    try {
      let info = fDir.query_filesystem_info('standard::type', null)
      if ((info) && (info.get_file_type() != Gio.FileType.DIRECTORY)) {
        return true
      }
    } catch(e) {}
    return false
  },

  on_panel_edit_mode_changed: function () {
    this.actor.reactive = global.settings.get_boolean('panel-edit-mode')
  },

  pinned_app_contr: function () {
    let pinnedAppsContr = this.pinnedAppsContr
    return pinnedAppsContr
  },

  acceptNewLauncher: function (path) {
    this.pinnedAppsContr._addFavorite(path, -1)
  },

  removeLauncher: function (appGroup) {
    // Add code here to remove the launcher if you want.
  },

  recent_items_contr: function () {
    return this.recentItems
  },

  recent_items_manager: function () {
    return this.recentManager
  },

  on_recent_items_changed: function () {
    this.recentItems = this.recentManager.get_items().sort(function (a, b) { return a.get_modified() - b.get_modified(); }).reverse()
  },

  _onWorkspaceCreatedOrDestroyed: function (i) {
    var workspaces = _.filter(global.screen.get_workspace_by_index(i), (ws, key)=>{
      return key in range(global.screen.n_workspaces) 
    })

    // We'd like to know what workspaces in this.metaWorkspaces have been destroyed and
    // so are no longer in the workspaces list.  For each of those, we should destroy them

    for (let i = 0, len = this.metaWorkspaces.length; i < len; i++) {
      if (workspaces.indexOf(this.metaWorkspaces[i].ws) == -1) {
        this.metaWorkspaces[i].appList.destroy()
        _.pullAt(this.metaWorkspaces, i)
      }
    }
  },

  _onSwitchWorkspace: function (winManager, previousWorkspaceIndex, currentWorkspaceIndex) {
    let metaWorkspace = global.screen.get_workspace_by_index(currentWorkspaceIndex)
    
    // If the workspace we switched to isn't in our list,
    // we need to create an AppList for it
    var refWorkspace = _.findIndex(this.metaWorkspaces, {index: currentWorkspaceIndex})
    if (refWorkspace === -1) {
      var appList = new AppList.AppList(this, metaWorkspace)
      this.metaWorkspaces.push({
        ws: metaWorkspace,
        appList: appList,
        index: currentWorkspaceIndex,
      })
    }

    // this.actor can only have one child, so setting the child
    // will automatically unparent anything that was previously there, which
    // is exactly what we want.
    var list = refWorkspace !== -1 ? this.metaWorkspaces[refWorkspace].appList : appList
    this._box.set_child(list.actor)
    list._refreshApps()
  },

  _onOverviewShow: function () {
    this.actor.hide()
  },

  _onOverviewHide: function () {
    this.actor.show()
  },

  _onMoveToNextMonitor: function () {
    this._onMoveToMonitor(1)
  },

  _onMoveToPrevMonitor: function () {
    this._onMoveToMonitor(-1)
  },

  _onMoveToMonitor: function (modifier) {
    // Skip when we don't have multiple monitor.
    let monitors = Main.layoutManager.monitors
    if (monitors.length <= 1) {
      return
    }
    // Find the window to move.
    let metaWorkspace = global.screen.get_active_workspace()
    let metaWindow = null
    metaWorkspace.list_windows().forEach(Lang.bind(this, function (win) {
      if (win.has_focus()) {
        metaWindow = win
      }
    }))
    // Find the new monitor index.
    let monitorIndex = metaWindow.get_monitor()
    monitorIndex += modifier
    if (monitorIndex < 0) {
      monitorIndex = monitors.length - 1
    }
    else if (monitorIndex > monitors.length - 1) {
      monitorIndex = 0
    }
    try {
      metaWindow.move_to_monitor(monitorIndex)
    } catch(e) {}
  },

  destroy: function () {
    this.signals.disconnectAll()
    this.actor.destroy()
    this.actor = null
  }
}

function main (metadata, orientation, panel_height, instance_id) {
  let myApplet = new MyApplet(metadata, orientation, panel_height, instance_id)
  return myApplet
}
