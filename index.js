var WebSocketServer = require('websocket').server;
var http = require('http');
var fs = require('fs');

function myLOG(str) {
    console.log((new Date()) + " " + str);
}

function TimeTrack() {
   this.starttime = null;
}

TimeTrack.prototype.start = function() {
   this.starttime = new Date();
}

TimeTrack.prototype.elapsed = function() {
   var end = new Date();
   var dif = end - this.starttime;
   return parseInt(dif);
}

TimeTrack.prototype.elapsedAndStart = function() {
   var str = this.starttime;
   var end = new Date();
   this.start();

   return parseInt(end - str);
}


function GameDef_C1SM() {
    this.periods = 3;
    this.period_length_minutes = 20;
    this.intermission_length_minutes = 12;
    this.timeout_length_sec = 30;
    this.overtime_enabled = true;
    this.overtime_length_minutes = 5;
}


function GameDef_EJUN() {
    this.periods = 3;
    this.period_length_minutes = 15;
    this.intermission_length_minutes = 3;
    this.timeout_length_sec = 30;
    this.overtime_enabled = false;
    this.overtime_length_minutes = 0;
}

function GameDef_TEST() {
    this.periods = 3;
    this.period_length_minutes = 2;
    this.intermission_length_minutes = 1;
    this.timeout_length_sec = 30;
    this.overtime_enabled = true;
    this.overtime_length_minutes = 5;
}


function Penalty(minutes) {
    this.period_min = minutes;
    this.remaining_ms = parseInt(minutes) * 60 * 1000;
    this.old_remaining_minutes = -1;
    this.remaining_minutes = minutes;
    this.remaining_seconds = 0;
    this.old_remaining_seconds = -1;
    this.finished = false;
    this.id = ++penaltycounter;
}

Penalty.prototype.forwardTime = function(ms) {
    var changes = false;
    this.remaining_ms -= parseInt(ms);
    if (this.remaining_ms <= 0) {
        this.remaining_ms = 0;
        this.remaining_minutes = 0;
        this.remaining_seconds = 0;
        this.finished = true;
        changes = true;
    } else {
        this.remaining_minutes = parseInt((this.remaining_ms / 1000) / 60);
        this.remaining_seconds = parseInt((this.remaining_ms / 1000) % 60);
        if (this.remaining_minutes !== this.old_remaining_minutes || this.remaining_seconds !== this.old_remaining_seconds) {
            changes = true;
            this.old_remaining_seconds = this.remaining_seconds;
            this.old_remaining_minutes = this.remaining_minutes;
        }
    }

    return changes;
}


var game = new Game(new GameDef_C1SM());


var penaltycounter = 0;

var GAMESTATE_NOTSTARTED	=	"PELI EI OLE ALKANUT"
var GAMESTATE_PERIOD_1		=	"1. ERA"
var GAMESTATE_INTERMISSION_1	=	"1. ERATAUKO"
var GAMESTATE_PERIOD_2		=	"2. ERA"
var GAMESTATE_INTERMISSION_2	=	"2. ERATAUKO"
var GAMESTATE_PERIOD_3		=	"3. ERA"
var GAMESTATE_OVERTIME		=	"JATKOAIKA"
var GAMESTATE_FINISHED		=	"PELI PAATTYNYT"
var GAMESTATE_TIMEOUT_VISITOR	=	"AIKALISA VIERAS"
var GAMESTATE_TIMEOUT_HOME	=	"AIKALISA KOTI"


function Game(def) {
    this.def = def;
    this.current_period = 1;
    this.state = GAMESTATE_NOTSTARTED;
    this.returnstate = ""; // Return to this state for example after timeout has finished. woohaa.
    this.homegoals = 0;
    this.running = false;
    this.visitorgoals = 0;

    this.periodlength_ms = this.def.period_length_minutes * 60 * 1000;

    this.periodelapsed_ms = 0;
    this.periodelapsed_minutes = 0;
    this.periodelapsed_seconds = 0;
    this.old_periodelapsed_minutes = -1;
    this.old_periodelapsed_seconds = -1;

    this.intermission_remaining_ms = 0;
    this.intermission_remaining_minutes = 0;
    this.intermission_remaining_seconds = 0;
    this.old_intermission_remaining_minutes = 0;
    this.old_intermission_remaining_seconds = 0;

    this.timeout_remaining_ms = 0;
    this.timeout_remaining_minutes = 0;
    this.timeout_remaining_seconds = 0;
    this.old_timeout_remaining_minutes = 0;
    this.old_timeout_remaining_seconds = 0;

    this.homepenalties = [];
    this.visitorpenalties = [];
}

Game.prototype.toState = function(state)
{
    if (state !== this.state) {
        console.log((new Date()) + " GAMESTATE: " + this.state + " => " + state);
        this.state = state; 
    }
}

Game.prototype.transferState = function(oldstate, newstate) {
    if (this.state === oldstate) {
         this.toState(newstate);
         return true;
    }

    myLOG("not changed to " + newstate + " since state was " + this.state + " but expected to be " + oldstate);

    return false;
}

Game.prototype.canAddPenalty = function() {
    if (this.running === true) {
        myLOG("cannot add penalty while running");
        return false;
    }
    
    switch (this.state) {
        case GAMESTATE_TIMEOUT_HOME:
        case GAMESTATE_TIMEOUT_VISITOR:
            myLOG("cannot add penalty at state: " + this.state);
            return false;
        break;
    }

    return true;
}

Game.prototype.addHomePenalty = function(mins)
{
    if (this.canAddPenalty() === true) {
        var penalty = new Penalty(parseInt(mins));
        this.homepenalties.push(penalty);
    }
}

Game.prototype.addVisitorPenalty = function(mins)
{
    if (this.canAddPenalty() === true) {
        var penalty = new Penalty(parseInt(mins));
        this.visitorpenalties.push(penalty);
    }
}

Game.prototype.delHomePenalty = function(index)
{
    var idx = parseInt(index);
    if (idx < 0 || idx > 4) {
        return;
    }
    this.homepenalties.splice(idx, 1);
}

Game.prototype.delVisitorPenalty = function(index)
{
    var idx = parseInt(index);
    if (idx < 0 || idx > 4) {
        return;
    }
    this.visitorpenalties.splice(idx, 1);
}

Game.prototype.modHomeGoal = function(dif, cb) {
    var _enter = parseInt(this.homegoals);
    var _new = _enter + parseInt(dif);

    if (_new < 0) {
        _new = 0;
    }
    if (_new !== _enter) {
        this.homegoals = _new;
        if (cb !== null) {
            cb();
        }
    }
}

Game.prototype.modVisitorGoal = function(dif, cb) {
    var _enter = parseInt(this.visitorgoals);
    var _new = _enter + parseInt(dif);

    if (_new < 0) {
        _new = 0;
    }
    if (_new !== _enter) {
        this.visitorgoals = _new;
        if (cb !== null) {
            cb();
        }
    }
}

Game.prototype.finishThisGame = function() {
    this.toState(GAMESTATE_FINISHED);
    this.running = false;
}

Game.prototype.startThisGame = function() {
    if (this.state === GAMESTATE_NOTSTARTED) {
        this.toState(GAMESTATE_PERIOD_1);
        this.running = true;
        timetracker.start();
        return true;
    } else if (this.state === GAMESTATE_PERIOD_1 ||
               this.state === GAMESTATE_PERIOD_2 ||
               this.state === GAMESTATE_PERIOD_3) {
        if (this.running === false) {
            this.running = true;
            timetracker.start();
            return true;
        }
    } else if (this.state === GAMESTATE_OVERTIME) {
        if (this.running === false) {
            this.running = true;
            timetracker.start();
            return true;
        }
    }

    return false;
}

Game.prototype.startPeriod = function(name) {
    if (this.state === GAMESTATE_INTERMISSION_1 ||
        this.state === GAMESTATE_INTERMISSION_2) {
        this.toState(name);
        this.running = false;
        this.periodelapsed_ms = 0;
        this.periodelapsed_minutes = 0;
        this.periodelapsed_seconds = 0;
        timetracker.start();
    } 
}

Game.prototype.pauseThisGame = function() {
    if (this.running === true) {
        this.running = false;
        var elapsed = timetracker.elapsed();
        theGAME.forwardTime(elapsed, sendStateToClients);
        return true;
    }
    return false;
}

Game.prototype.forwardTime = function(milliseconds, cb, force) {
    var periodFinished = false;
    var reportChanges = false;

    if (!this.running) {
        if (force === undefined || force !== true) {
            return false;
        }
    }

    this.periodelapsed_ms += parseInt(milliseconds);
    if (this.periodelapsed_ms >= this.periodlength_ms) {
        // Period finished.
        this.periodelapsed_ms = this.periodlength_ms;
        periodFinished = true;
    }
    if (this.periodelapsed_ms < 0) {
        this.periodelapsed_ms = 0;
    }

    this.periodelapsed_seconds = parseInt(this.periodelapsed_ms / 1000 + 0.0001) % 60;
    this.periodelapsed_minutes = parseInt((this.periodelapsed_ms / 1000) / 60 + 0.0001);
 
    if (this.periodelapsed_seconds !== this.old_periodelapsed_seconds || this.periodelapsed_minutes !== this.old_periodelapsed_minutes) {
        this.old_periodelapsed_seconds = this.periodelapsed_seconds;
        this.old_periodelapsed_minutes = this.periodelapsed_minutes;
        reportChanges = true;
    }

    for (var c=this.homepenalties.length-1; c>=0; --c) {
        this.homepenalties[c].forwardTime(milliseconds);
        if (this.homepenalties[c].finished === true) {
            reportChanges = true;
            this.homepenalties.splice(c, 1);
        }
    }
   
    for (var c=this.visitorpenalties.length-1; c>=0; --c) {
        this.visitorpenalties[c].forwardTime(milliseconds);
        if (this.visitorpenalties[c].finished === true) {
            reportChanges = true;
            this.visitorpenalties.splice(c, 1);
        }
    }

    if (reportChanges === true && cb !== null) {
        cb();
    }

    return periodFinished;
}

Game.prototype.startIntermission = function(state) {
    timetrackerintermission.start();

    this.intermission_remaining_ms = this.def.intermission_length_minutes * 60 * 1000;

    this.toState(state); 
    this.running = false;

    this.rewindIntermission(0);
}

Game.prototype.rewindIntermission = function(milliseconds, cb) {
    if (this.state !== GAMESTATE_INTERMISSION_1 &&
        this.state !== GAMESTATE_INTERMISSION_2) {
        // Invalid state. Bail out.

        this.intermission_remaining_minutes = 0;
        this.intermission_remaining_seconds = 0;
        this.old_intermission_remaining_minutes = 0;
        this.old_intermission_remaining_seconds = 0;

        return;
    }

    this.intermission_remaining_ms -= parseInt(milliseconds);
    if (this.intermission_remaining_ms <= 0) {
        this.intermission_remaining_ms = 0;

        this.intermission_remaining_minutes = 0;
        this.intermission_remaining_seconds = 0;
        this.old_intermission_remaining_minutes = 0;
        this.old_intermission_remaining_seconds = 0;

        return true;
    }

    this.intermission_remaining_seconds = parseInt(this.intermission_remaining_ms / 1000 + 0.0001) % 60;
    this.intermission_remaining_minutes = parseInt((this.intermission_remaining_ms / 1000) / 60 + 0.0001);
    if (this.intermission_remaining_seconds != this.old_intermission_remaining_seconds || this.intermission_remaining_minutes != this.old_intermission_remaining_minutes) {
        this.old_intermission_remaining_seconds = this.intermission_remaining_seconds;
        this.old_intermission_remaining_minutes = this.intermission_remaining_minutes;

        if (cb !== undefined) {
            cb();
        }
    }

    return false;
}

Game.prototype.endThisIntermission = function() {
    if (this.state === GAMESTATE_INTERMISSION_1) {
        this.startPeriod(GAMESTATE_PERIOD_2);
    } else if (this.state == GAMESTATE_INTERMISSION_2) {
        this.startPeriod(GAMESTATE_PERIOD_3);
    }
}

Game.prototype.startTimeout = function(timeoutstate) {
    if (this.running === true) {
        // Not allowed if running.
        return;
    }
    switch (this.state) {
        case GAMESTATE_PERIOD_1:
        case GAMESTATE_PERIOD_2: 
        case GAMESTATE_PERIOD_3:
        break;

        default:
            console.log((new Date()) + " timeout not allowed in state: " + this.state);
            return;
    }
    this.savedstate = this.state;
    this.running = false;
    this.timeout_remaining_ms = 30 * 1000;
    timetrackertimeout.start();
    this.toState(timeoutstate);
    this.rewindTimeout(0);
}


Game.prototype.rewindTimeout = function(milliseconds, cb) {
    if (this.state !== GAMESTATE_TIMEOUT_HOME &&
        this.state !== GAMESTATE_TIMEOUT_VISITOR) {

        this.old_timeout_remaining_minutes = 0;
        this.old_timeout_remaining_seconds = 0;
        this.timeout_remaining_minutes = 0;
        this.timeout_remaining_seconds = 0;
        this.timeout_remaining_ms = 0;

        // -> Invalid state. Bail out.
        return true;
    }

    this.timeout_remaining_ms -= parseInt(milliseconds);
    if (this.timeout_remaining_ms <= 0) {

        this.old_timeout_remaining_minutes = 0;
        this.old_timeout_remaining_seconds = 0;
        this.timeout_remaining_minutes = 0;
        this.timeout_remaining_seconds = 0;
        this.timeout_remaining_ms = 0;

        return true;
    }

    this.timeout_remaining_seconds = parseInt(this.timeout_remaining_ms / 1000 + 0.0001) % 60;
    this.timeout_remaining_minutes = parseInt((this.timeout_remaining_ms / 1000) / 60 + 0.0001);

    if (this.timeout_remaining_minutes != this.old_timeout_remaining_minutes || this.timeout_remaining_seconds != this.old_timeout_remaining_seconds) {
        this.old_timeout_remaining_seconds = this.timeout_remaining_seconds;
        this.old_timeout_remaining_minutes = this.timeout_remaining_minutes;
     
        if (cb !== undefined) {
            cb();
        }
    }

    return false;
}

Game.prototype.endThisTimeout = function() {
    if ((this.state === GAMESTATE_TIMEOUT_HOME || this.state === GAMESTATE_TIMEOUT_VISITOR) && this.savedstate.length > 0) {
        this.toState(this.savedstate);
        this.savedstate = "";
        this.running = false;
        return true;
    }
}

Game.prototype.startOvertime = function() {
    this.toState(GAMESTATE_OVERTIME);
    this.periodelapsed_ms = 0;
    this.periodelapsed_minutes = 0;
    this.periodelapsed_seconds = 0;
    this.running = false;
}
 

var theGAME = new Game(new GameDef_TEST());
var timetracker = new TimeTrack();
var timetrackertimeout = new TimeTrack();
var timetrackerintermission = new TimeTrack();

setTimeout(gameProceed, 250);

String.prototype.endsWith = function (s) {
  return this.length >= s.length && this.substr(this.length - s.length) == s;
}
var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    var url = "" + request.url;
    if (url == "/viewer" || url == "/manager" || url == "/") {
            console.log((new Date()) + 'returning index.html');
	    fs.readFile('index.html',function (err, data) {
                var content = "" + data;
                if (url == "/manager") {
                    content = content.replace("__VIEWER__", "__MANAGER__");
                }
		response.writeHead(200, {'Content-Type': 'text/html','Content-Length':content.length});
		response.write(content);
		response.end();
	    });
    } else if (url.endsWith(".js") == true) {
            console.log((new Date()) + 'returning .' + url);
	    fs.readFile('.' + url,function (err, data){
		response.writeHead(200, {'Content-Type': 'application/javascript','Content-Length':data.length});
		response.write(data);
		response.end();      
	    });
    } else if (url.endsWith(".css") == true) {
            console.log((new Date()) + 'returning .' + url);
	    fs.readFile('.' + url,function (err, data){
		response.writeHead(200, {'Content-Type': 'text/css','Content-Length':data.length});
		response.write(data);
		response.end();      
	    });
    } else {
            console.log((new Date()) + 'response 404');
            response.writeHead(404);
            response.end();
    }
});

server.listen(8080, function() {
    console.log((new Date()) + ' Server is listening on port 8080');
});

wsServer = new WebSocketServer({
    httpServer: server,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // put logic here to detect whether the specified origin is allowed.
  return true;
}

var connIndex = 1;
var connections = [];

function discardConnection(id) {
    for (var c=0;c<connections.length; ++c) {
        if (connections[c].id === id) {
            connections.splice(c, 1);
            return;
        }
    }
}

function ConnectionContainer(containedConnection) {
    this.connection = containedConnection;
    this.id = connIndex++;
}



function sendStateToClients() {
    var state = { };
    state["_evt"]  = "STATE";
    state["_data"] = theGAME;
    var txt = JSON.stringify(state);

    for (var c=0; c<connections.length; ++c) {
        connections[c].connection.sendUTF(txt);
    }
}

wsServer.on('connection', function(socket) {
	console.log("NewSocketThisIs");
});

wsServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }

    var connection = request.accept('scoreboard-protocol', request.origin);
    console.log((new Date()) + ' Connection accepted.');

    var container = new ConnectionContainer(connection);
    connections.push(container);
    sendStateToClients(); 

    connection.on('message', function(message) {
        if (message.type === 'utf8') {
            console.log('Received Message: ' + message.utf8Data);
            var object = JSON.parse(message.utf8Data);
            var cmd = object["_cmd"];
            var arg = object["_arg"];
            if (cmd === "start") {
                if (theGAME.startThisGame() === true) {
                    sendStateToClients();
                }
            } else if (cmd === "pause") {
                if (theGAME.pauseThisGame() === true) {
                    sendStateToClients();
                }
            } else if (cmd === "incsec") {
                if (theGAME.running) {
                    gameProceed(1000);
                } else {
                    theGAME.forwardTime(1000, sendStateToClients, true);
                }
            } else if (cmd === "decsec") {
                if (theGAME.running) {
                    gameProceed(-1000);
                } else {
                    theGAME.forwardTime(-1000, sendStateToClients, true);
                }
           } else if (cmd === "incmin") {
                if (theGAME.running) {
                    gameProceed(60 * 1000);
                } else {
                    theGAME.forwardTime(60 * 1000, sendStateToClients, true);
                }
            } else if (cmd === "decmin") {
                if (theGAME.running) {
                     gameProceed(-60 * 1000);
                } else {
                     theGAME.forwardTime(-60 * 1000, sendStateToClients, true);
                }
            } else if (cmd === "inchome") {
                theGAME.modHomeGoal(1, sendStateToClients);
            } else if (cmd === "dechome") {
                theGAME.modHomeGoal(-1, sendStateToClients);
            } else if (cmd === "incvisitor") {
                theGAME.modVisitorGoal(1, sendStateToClients);
            } else if (cmd === "decvisitor") {
                theGAME.modVisitorGoal(-1, sendStateToClients);
            } else if (cmd === "addhomepenalty2") {
                theGAME.addHomePenalty(2);
                sendStateToClients();
            } else if (cmd === "addhomepenalty5") {
                theGAME.addHomePenalty(5);
                sendStateToClients();
            } else if (cmd === "addvisitorpenalty2") {
                theGAME.addVisitorPenalty(2);
                sendStateToClients();
            } else if (cmd === "addvisitorpenalty5") {
                theGAME.addVisitorPenalty(5);
                sendStateToClients();
            } else if (cmd === "delhomepenalty") {
                theGAME.delHomePenalty(arg);
                sendStateToClients();
            } else if (cmd === "delvisitorpenalty") {
                theGAME.delVisitorPenalty(arg);
                sendStateToClients();
            } else if (cmd === "hometimeout") {
                theGAME.startTimeout(GAMESTATE_TIMEOUT_HOME);
                sendStateToClients();
            } else if (cmd === "visitortimeout") {
                theGAME.startTimeout(GAMESTATE_TIMEOUT_VISITOR);
                sendStateToClients();
            } else if (cmd === "nextstate") {
                theGAME.endThisTimeout();
                theGAME.endThisIntermission();
                sendStateToClients();
            } else if (cmd === "creategame_c1sm") {
                theGAME = new Game(new GameDef_C1SM());
                sendStateToClients();
            } else if (cmd === "creategame_ejun") {
                theGAME = new Game(new GameDef_EJUN());
                sendStateToClients();               
            } else if (cmd === "creategame_test") {
                theGAME = new Game(new GameDef_TEST());
                sendStateToClients();               
            }
        }
    });
    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
        discardConnection(container.id);
    });
});


function gameProceed(increment_ms) {
    var ms = 0;
    if (increment_ms !== undefined) {
        ms += parseInt(increment_ms);
    }

    switch (theGAME.state) {
        case GAMESTATE_NOTSTARTED:
        break;

        case GAMESTATE_OVERTIME:
            if (theGAME.forwardTime(ms + timetracker.elapsedAndStart(), sendStateToClients) === true) {
                theGAME.finishThisGame();
                theGAME.forwardTime(0);
                sendStateToClients();
            }
        break;

	case GAMESTATE_PERIOD_1:
            if (theGAME.forwardTime(ms + timetracker.elapsedAndStart(), sendStateToClients) === true) {
                theGAME.startIntermission(GAMESTATE_INTERMISSION_1);
                sendStateToClients();
            }
        break;

	case GAMESTATE_INTERMISSION_1:
            if (theGAME.rewindIntermission(ms + timetrackerintermission.elapsedAndStart(), sendStateToClients) === true) {
                theGAME.startPeriod(GAMESTATE_PERIOD_2);
                sendStateToClients();
            }
        break;

	case GAMESTATE_PERIOD_2:
            if (theGAME.forwardTime(ms + timetracker.elapsedAndStart(), sendStateToClients) === true) {
                theGAME.startIntermission(GAMESTATE_INTERMISSION_2);
                sendStateToClients();
            }
	break;

	case GAMESTATE_INTERMISSION_2:
            if (theGAME.rewindIntermission(ms + timetrackerintermission.elapsedAndStart(), sendStateToClients) === true) {
                theGAME.startPeriod(GAMESTATE_PERIOD_3);
                sendStateToClients();
            }
        break;

	case GAMESTATE_PERIOD_3:
            if (theGAME.forwardTime(ms + timetracker.elapsedAndStart(), sendStateToClients) === true) {
                if (theGAME.def.overtime_enabled) {
                    if (theGAME.homegoals === theGAME.visitorgoals) {
                        theGAME.startOvertime();
                    } else theGAME.finishThisGame();
                } else theGAME.finishThisGame();
                sendStateToClients();
            }
	break;

        case GAMESTATE_TIMEOUT_HOME:
        case GAMESTATE_TIMEOUT_VISITOR: 
            if (theGAME.rewindTimeout(ms + timetrackertimeout.elapsedAndStart(), sendStateToClients) === true) {
                theGAME.endThisTimeout();
                sendStateToClients();
           }
        break;
    }
    setTimeout(gameProceed, 250);
}
