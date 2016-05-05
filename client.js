/** 
 * hive.js 
 * Copyright (C) 2013-2016 Marcel Klehr <mklehr@gmx.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the Mozilla Public License version 2
 * as published by the Mozilla Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the Mozilla Public License
 * along with this program.  If not, see <https://www.mozilla.org/en-US/MPL/2.0/>.
 */
var jsonParse = require('json-stream')
  , through = require('through2')
  , duplexify = require('duplexify')
  , vdom = require('virtual-dom')
  , h = vdom.h

module.exports = setup
module.exports.consumes = ['ui', 'editor', 'api', 'settings']
module.exports.provides = ['chat']
function setup(plugin, imports, register) {
  var ui = imports.ui
    , editor = imports.editor
    , api = imports.api
    , settings = imports.settings

  ui.reduxReducerMap.chat = reducer

  function reducer(state, action) {
    if(!state) {
      return {
        active: false
      , windowSize: 'full'
      , messages: []
      , users: {}
      }
    }
    if('CHAT_ACTIVATE' === action.type) {
      return {...state, messages: [], active: true}
    }
    if('CHAT_DEACTIVATE' === action.type) {
      return {...state, messages: [], active: false}
    }
    if('CHAT_ADD_MESSAGE' === action.type) {
      return {...state, messages: state.messages.concat([action.payload])}
    }
    if('CHAT_LOAD_USER' === action.type) {
      return {...state, users: {...state.users, [action.payload.id]: action.payload}}
    }
    if('CHAT_RESIZE' === action.type) {
      return {...state, windowSize: action.payload}
    }
    return state
  }

  var chat = {
    action_activate: function() {
      return {type: 'CHAT_ACTIVATE'}
    }
  , action_deactivate: function(){
      return {type: 'CHAT_DEACTIVATE'}
    }
  , action_createMessage: function*(text) {
      var msg = yield {type: 'CHAT_CREATE_MESSAGE', payload: text}
      return yield {type: 'CHAT_ADD_MESSAGE', payload: msg}
    }
  , action_addMessage: function(msg) {
      return {type: 'CHAT_ADD_MESSAGE', payload: msg}
    }
  , action_resize: function*(size) {
      return yield [
        {type: 'CHAT_RESIZE', payload: size}
      , settings.action_setForUser({'chat:windowSize': size})
      ]
    }
  , action_loadUser: function*(userId) {
      var user = yield api.action_user_get(userId)
      return yield {type: 'CHAT_LOAD_USER', payload: user}
    }
  , stream: null
  }

  const middleware = store => next => action => {
    if('CHAT_CREATE_MESSAGE' === action.type) {
      var user = store.getState().session.user.id
        , msg = {user, text: action.payload}
      chat.stream.write(msg)
      return Promise.resolve(msg)
    }
    if('CHAT_ADD_MESSAGE' === action.type) {
      if(store.getState().chat.users[action.payload.user]) {
        return next(action)
      }
      // intercept add message actions and load the associated user object
      return store.dispatch(chat.action_loadUser(action.payload.user))
      .then(function() {
        return next(action)
      })
    }
    return next(action)
  }
  ui.reduxMiddleware.push(middleware)

  editor.onLoad((editableDoc, broadcast, onClose) => {
    ui.store.dispatch(chat.action_activate())

    // Set up the chat broadcast
    var writable = jsonStringify()
      , readable = jsonParse()
    chat.stream = duplexify.obj(writable, readable)

    writable
    .pipe(broadcast.createDuplexStream(new Buffer('chat')))
    .pipe(readable)

    ui.store.dispatch({type: 'CHAT_LOAD_USER'
    , payload: ui.store.getState().session.user})

    chat.stream.on('readable', function() {
      var msg
      while(msg = chat.stream.read()) {
        ui.store.dispatch(chat.action_addMessage(msg))
      }
    })

    var dispose = settings.onChange(_=> {
      ui.store.dispatch(
        {type: 'CHAT_RESIZE', payload: settings.getForUser('chat:windowSize')})
    })

    onClose(_=> {
      chat.stream = null
      ui.store.dispatch(chat.action_deactivate())
      dispose()
    })
  })

  ui.onRenderBody((store, children) => {
    if(ui.store.getState().chat.active) children.unshift(render(store))
  })

  settings.onRenderUserSettings((children) => {
    children.push(renderSetting(ui.store))
  })

  function renderSetting(store) {
    var state = store.getState()
    return h('div', [
    , h('h4', 'Chat')
    , h('ul.list-group',
        h('li.list-group-item', [
          h('label', [
            h('input', {
              type: 'checkbox'
            , 'ev-change': evt => {
                store.dispatch(settings.action_setForUser({
                  'chat:windowSize': evt.currentTarget.checked? 'minimized' : 'full'
                }))
              }
            , attributes: settings.getForUser('chat:windowSize') == 'minimized'? {checked: true} : {}
            })
          , ' '+ui._('plugin-chat/setting-keep-minimized')()
          ])
        ])
      )
    ])
  }

  function render(store) {
    var state = store.getState().chat
    return h('div.Chat.Chat--'+state.windowSize,{
      'ev-click': (evt) =>
        state.windowSize=='minimized'?
          store.dispatch(chat.action_resize('medium'))
        : null
    }, [
      renderHeader(store)
    , renderMessages(store)
    , renderInterface(store)
    ])
  }

  function renderHeader(store) {
    var state = store.getState().chat
    return h('div.Chat__header', [
      h('div.btn-group.Chat__header__controls', [
        h('a.btn.Chat__controls__minimize', {
          attributes: {'aria-label':ui._('plugin-chat/minimize')}
        , 'ev-click': evt => store.dispatch(chat.action_resize('minimized'))
        },h('i.glyphicon.glyphicon-minus'))
      , h('a.btn.Chat__controls__medium'+(state.windowSize=='medium'? '.active' : ''), {
          attributes: {'aria-label':ui._('plugin-chat/mediumsize')(), 'aria-pressed': (state.windowSize=='medium'? 'true' : 'false')}
        , 'ev-click': evt => store.dispatch(chat.action_resize('medium'))
        }, h('i.glyphicon.glyphicon-resize-small'))
      , h('a.btn.Chat__controls__full'+(state.windowSize=='full'? '.active' : ''), {
          attributes: {'aria-label':ui._('plugin-chat/maximize')(), 'aria-pressed': (state.windowSize=='full'? 'true' : 'false')}
        , 'ev-click': evt => store.dispatch(chat.action_resize('full'))
        }, h('i.glyphicon.glyphicon-resize-full'))
      ])
    , h('h5', [
        h('i.glyphicon.glyphicon-comment')
      , ' '+ui._('plugin-chat/chat')()+' '
      , h('small', ui._('plugin-chat/chat-subheading')())
      ])
    ])
  }

  function renderInterface(store) {
    return h('form.form-inline.Chat__Interface', [
      h('div.input-group',[
        h('label.sr-only', {attributes:{for: 'message'}}, ui._('plugin-chat/message')()),
        h('input.form-control', {attributes:{
            type:'text'
          , name: 'message'
          , placeholder: ui._('plugin-chat/message')()
          },
          'ev-keydown': evt => {
          if(evt.keyCode == 13) {
            evt.preventDefault()
            store.dispatch(chat.action_createMessage(evt.currentTarget.value))
            evt.currentTarget.value = ''
          }
        }})
      ]),
      h('input.btn.btn-default.btn-block.hidden-md.hidden-lg', {
        attributes:{type:'submit', value: ui._('plugin-chat/send')()}
      , 'ev-click': evt => {
          evt.preventDefault()
          store.dispatch(chat.action_createMessage(evt.currentTarget.previousSibling.value))
          evt.currentTarget.previousSibling.value = ''
        }
      })
    ])
  }

  function renderMessages(store) {
    var state = store.getState().chat
    return h('div.Chat__messages', {
      scrollTop: new ScrollHook()
    , key: 1
    },
    state.messages.map(function(msg) {
      return renderMessage(state, msg)
    })
    )
  }

  function ScrollHook() {
    this.scrollHeight
  }
  ScrollHook.prototype.hook = function(node, propName, previous) {
    // scrollHeight is the full height that the content would need
    // clientHeight is the height that is actually available

    // we give a 10px margin here to account for any weirdness that might be going on
    if(previous && node.scrollTop+10 < previous.scrollHeight-node.clientHeight) {
      this.scrollHeight = node.scrollHeight
      return
    }else{
      this.scrollHeight = node.scrollHeight
      setImmediate(function() {
        node.scrollTop = node.scrollHeight-node.clientHeight
      })
    }
  }

  function renderMessage(state, msg) {
    return h('div.Chat__Message', {attributes:{'data-user': msg.user}}, [
      h('span.Chat__Message__User', state.users[msg.user].attributes.name)
    , ': '
    , h('span.Chat__Message__Text', msg.text)
    ])
  }

  register(null, {chat})
}


function jsonStringify() {
  return through.obj(function(buf, enc, cb) {
    this.push(JSON.stringify(buf)+'\n')
    cb()
  })
}
