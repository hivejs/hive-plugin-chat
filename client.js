/**
 * hive.js
 * Copyright (C) 2013-2015 Marcel Klehr <mklehr@gmx.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
var jsonParse = require('json-stream')
  , through = require('through2')
  , duplexify = require('duplexify')
  , vdom = require('virtual-dom')
  , h = vdom.h

module.exports = setup
module.exports.consumes = ['ui', 'editor', 'api']
module.exports.provides = ['chat']
function setup(plugin, imports, register) {
  var ui = imports.ui
    , editor = imports.editor
    , api = imports.api

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
  , action_createMessage: function*(text) {
      var msg = yield {type: 'CHAT_CREATE_MESSAGE', payload: text}
      return yield {type: 'CHAT_ADD_MESSAGE', payload: msg}
    }
  , action_addMessage: function(msg) {
      return {type: 'CHAT_ADD_MESSAGE', payload: msg}
    }
  , action_resize: function(size) {
      return {type: 'CHAT_RESIZE', payload: size}
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
      // intercept add message actions and load the associated user object
      return store.dispatch(chat.action_loadUser(action.payload.user))
      .then(function() {
        return next(action)
      })
    }
    return next(action)
  }
  ui.reduxMiddleware.push(middleware)

  editor.onLoad((editableDoc, broadcast) => {
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
  })

  ui.onRenderBody((store, children) => {
    if(ui.store.getState().chat.active) children.unshift(render(store))
  })

  function render(store) {
    var state = store.getState().chat
    // set window size
    var windowSize = state.windowSize == 'minimized'?
      '.Chat--minimized' : ''
    return h('div.Chat'+windowSize, [
      renderHeader(store)
    , renderMessages(store)
    , renderInterface(store)
    ])
  }

  function renderHeader(store) {
    return h('div.Chat__header', [
      h('div.btn-group.Chat__header__controls', [
        h('a.btn.glyphicon.glyphicon-minus', {
          attributes: {'aria-label':'Minimize chat window'}
        , 'ev-click': evt => store.dispatch(chat.action_resize('minimized'))
        })
      , h('a.btn.glyphicon.glyphicon-pushpin', {
          attributes: {'aria-label':'Keep chat window open'}
        , 'ev-click': evt => store.dispatch(chat.action_resize('full'))
        })
      ])
    , h('h5', [
        h('i.glyphicon.glyphicon-comment')
      , ' Chat '
      , h('small', 'discuss and inspire')
      ])
    ])
  }

  function renderInterface(store) {
    return h('form.form-inline.Chat__Interface', [
      h('div.input-group',[
        h('label.sr-only', {attributes:{for: 'message'}}, 'Chat message'),
        h('input.form-control', {attributes:{
            type:'text'
          , name: 'message'
          , placeholder: 'Chat message'
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
        attributes:{type:'submit', value: 'send'}
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
    if(previous && node.scrollTop < previous.scrollHeight-node.clientHeight) {
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
      h('span.Chat__Message__User', state.users[msg.user].name)
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
