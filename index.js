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


function GameDef() {
    this.periods = 3;
    this.period_length_min = 15;
    this.break_length_min = 3;
    this.timeout_length_sec = 30;
    this.overtime_enabled = false;
    this.overtime_length_min = 5;
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


var game = new Game();


var penaltycounter = 0;

var GAMESTATE_NOTSTARTED	=	"game_notstarted"
var GAMESTATE_RUNNING		=	"game_running"
var GAMESTATE_PAUSED		=	"game_paused"
var GAMESTATE_INTERMISSION	=	"game_intermission"
var GAMESTATE_OVERTIME		=	"game_overtime"
var GAMESTATE_TIMEOUT_HOME	=	"game_timeout_home"
var GAMESTATE_TIMEOUT_VISITOR	=	"game_timeout_visitor"

function Game() {
    this.def = new GameDef();
    this.old_periodelapsed_minutes = -1;
    this.old_periodelapsed_seconds = -1;
    this.current_period = 1;
    this.state = GAMESTATE_NOTSTARTED;
    this.homegoals = 0;
    this.visitorgoals = 0;
    this.periodelapsed_minutes = 0;
    this.periodelapsed_seconds = 0;
    this.periodelapsed_ms = 0;
    this.periodlength_ms = this.def.period_length_mins * 60 * 1000;
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

Game.prototype.addHomePenalty = function(mins)
{
    var penalty = new Penalty(parseInt(mins));
    this.homepenalties.push(penalty);
}

Game.prototype.addVisitorPenalty = function(mins)
{
    var penalty = new Penalty(parseInt(mins));
    this.visitorpenalties.push(penalty);
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

Game.prototype.startPeriod = function(period) {
    this.current_period = parseInt(period);
    
    this.state = GAMESTATE_RUNNING;
}

Game.prototype.forwardTime = function(milliseconds, cb) {
    var finished = false;
    var reportChanges = false;

    this.periodelapsed_ms += parseInt(milliseconds);
    if (this.periodelapsed_ms >= this.periodlength_ms) {
        // Period finished.
        this.periodelapsed_ms = this.periodlength_ms;
        finished = true;
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
        if (this.homepenalties[c].forwardTime(milliseconds) === true) {
//            reportChanges = true;
        }
        if (this.homepenalties[c].finished === true) {
            reportChanges = true;
            this.homepenalties.splice(c, 1);
        }
    }
   
    for (var c=this.visitorpenalties.length-1; c>=0; --c) {
        if (this.visitorpenalties[c].forwardTime(milliseconds) === true) {
  //          reportChanges = true;
        }
        if (this.visitorpenalties[c].finished === true) {
            reportChanges = true;
            this.visitorpenalties.splice(c, 1);
        }
    }

    if (reportChanges === true && cb !== null) {
        cb();
    }

    return finished;
}

Game.prototype.pause = function() {
    this.state = GAMESTATE_PAUSED;
}
 

var theGAME = new Game();
var timetracker = new TimeTrack();

setTimeout(gameProceed, 250);

var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    if (request.url == "/") {
            console.log((new Date()) + 'returning index.html');
	    fs.readFile('index.html',function (err, data){
		response.writeHead(200, {'Content-Type': 'text/html','Content-Length':data.length});
		response.write(data);
		response.end();
	    });
    } else if (request.url.endsWith(".js") == true) {
            console.log((new Date()) + 'returning .' + request.url);
	    fs.readFile('.' + request.url,function (err, data){
		response.writeHead(200, {'Content-Type': 'application/javascript','Content-Length':data.length});
		response.write(data);
		response.end();      
	    });
    } else if (request.url.endsWith(".css") == true) {
            console.log((new Date()) + 'returning .' + request.url);
	    fs.readFile('.' + request.url,function (err, data){
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
            if (cmd === "new") {
                theGAME = new Game();
	    } else if (cmd === "start") {
                if (theGAME.transferState(GAMESTATE_NOTSTARTED, GAMESTATE_RUNNING) === true) {
                    timetracker.start();
                    sendStateToClients();
                } else if (theGAME.transferState(GAMESTATE_PAUSED, GAMESTATE_RUNNING) === true) {
                    timetracker.start();
                    sendStateToClients();
                }
            } else if (cmd === "pause") {
                if (theGAME.transferState(GAMESTATE_RUNNING, GAMESTATE_PAUSED) === true) {
                    var elapsed = timetracker.elapsed();
                    theGAME.forwardTime(elapsed, sendStateToClients);
                    sendStateToClients();
                }
            } else if (cmd === "resume") {
                if (theGAME.transferState(GAMESTATE_PAUSED, GAMESTATE_RUNNING) === true) {
                    timetracker.start();
                    sendStateToClients();
                }
            } else if (cmd === "incsec") {
                theGAME.forwardTime(1000, sendStateToClients);
            } else if (cmd === "decsec") {
                theGAME.forwardTime(-1000, sendStateToClients);
           } else if (cmd === "incmin") {
                theGAME.forwardTime(60 * 1000, sendStateToClients);
            } else if (cmd === "decmin") {
                theGAME.forwardTime(60 * -1000, sendStateToClients);
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
            }
        }
    });
    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
        discardConnection(container.id);
    });
});


function gameProceed() {
    switch (theGAME.state) {
        case GAMESTATE_NOTSTARTED:
        case GAMESTATE_PAUSED:
            setTimeout(gameProceed, 500);
        break;

        case GAMESTATE_RUNNING:
            setTimeout(gameProceed, 250);
            theGAME.forwardTime(timetracker.elapsedAndStart(), sendStateToClients);
        break;

        case GAMESTATE_TIMEOUT_HOME:
        case GAMESTATE_TIMEOUT_VISITOR:
        break;
    }
}
