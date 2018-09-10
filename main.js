/**
 *
 * iogo adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "iogo",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js iogo Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@iogo.com>"
 *          ]
 *          "desc":         "iogo adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "materialize":  true,                       // support of admin3
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42,
 *          "mySelect": "auto"
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.iogo.0
const adapter = new utils.Adapter('iogo');

/*Variable declaration, since ES6 there are let to declare variables. Let has a more clearer definition where 
it is available then var.The variable is available inside a block and it's childs, but not outside. 
You can define the same variable name inside a child without produce a conflict with the variable of the parent block.*/
var lastMessageTime = 0;
var lastMessageText = '';
var users = {};
var FCM = require('fcm-node');
var fcm;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    if(id.endsWith('.token')){
        var user_name = id.replace('iogo.'+adapter.instance+'.','').replace('.token','');
        users[tmp] = state.val;
        adapter.log.info('user ' + user_name + ' changed');
        adapter.setState('users', JSON.stringify(users));
    }

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    send(obj);
    
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function main() {

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info('config serverKey: '    + adapter.config.serverKey);
    fcm = new FCM(adapter.config.serverKey);

    // in this iogo all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');

    // examples for the checkPassword/checkGroup functions
    adapter.checkPassword('admin', 'iobroker', function (res) {
        adapter.log.info('check user admin pw ioboker: ' + res);
    });

    adapter.checkGroup('admin', 'admin', function (res) {
        adapter.log.info('check group user admin group admin: ' + res);
    });

    adapter.objects.getObjectView('system','state',{startkey: 'iogo.' + adapter.instance + '.', endkey: 'iogo.' + adapter.instance + '.\u9999'}, 
        function (err, doc) {
            if (doc && doc.rows) {	
                for (var i = 0; i < doc.rows.length; i++) {
                        var id  = doc.rows[i].id;
                        var obj = doc.rows[i].value;
                        adapter.log.debug('Found ' + id + ': ' + JSON.stringify(obj));
                }
                        if (!doc.rows.length) adapter.log.warn('No objects found.');
            } else {
                adapter.log.warn('No objects found: ' + err);
            }
    });
}

function send(obj){
    if (!obj || !obj.command) return;

    // filter out double messages
    var json = JSON.stringify(obj);
    if (lastMessageTime && lastMessageText === JSON.stringify(obj) && new Date().getTime() - lastMessageTime < 1200) {
        adapter.log.debug('Filter out double message [first was for ' + (new Date().getTime() - lastMessageTime) + 'ms]: ' + json);
        return;
    }

    lastMessageTime = new Date().getTime();
    lastMessageText = json;

    switch (obj.command) {
        case 'send':
            {
                if (obj.message) {
                    var count;
                    if (typeof obj.message === 'object') {
                        count = sendMessage(obj.message.text, obj.message.user, obj.message);
                    } else {
                        count = sendMessage(obj.message);
                    }
                    if (obj.callback) adapter.sendTo(obj.from, obj.command, count, obj.callback);
                }
            }
    }
}

function sendMessage(text, user, options) {
    if (!text && (typeof options !== 'object')) {
        if (!text && text !== 0 && !options) {
            adapter.log.warn('Invalid text: null');
            return;
        }
    }

    if (options) {
        if (options.text !== undefined) delete options.text;
        if (options.title !== undefined) delete options.title;
        if (options.user !== undefined) delete options.user;
        if (options.priority !== undefined) delete options.priority;
    }

    // convert
    if (text !== undefined && text !== null && typeof text !== 'object') {
        text = text.toString();
    }

    var count = 0;
    var u;

    if (user) {

        var userarray = user.replace(/\s/g,'').split(',');
        var matches = 0;
        userarray.forEach(function (value) {
            if (users[value] !== undefined) {
                matches++;
                count += _sendMessageHelper(users[value], value, text, options);
            }
        });
        if (userarray.length != matches) adapter.log.warn(userarray.length - matches + ' of ' + userarray.length + ' recipients are unknown!');
        return count;
    } else {

        for (u in users) {
            count += _sendMessageHelper(users[u], u, text, options);
        }
    }
    return count;
}

function _sendMessageHelper(token, user, text, title, priority) {
    var count = 0;

    adapter.log.debug('Send message to "' + user + '": ' + text);

    var message = { 
        to: token, 
        priority : priority || 'normal',
        notification: {
            title: title || 'ioBroker news', 
            body: text
        }
    };

    if (fcm) {
        fcm.send(message, function(err, response){
                if (err) {
                    adapter.log.error('Cannot send message [user - ' + options.user + ']: ' + err);
                    options = null;
                } else {
                    adapter.log.info("Successfully sent with response: ", response);
                    count++;
                }
            });
    }
    
    return count;
}