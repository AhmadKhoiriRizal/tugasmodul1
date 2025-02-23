var debug = false;

var canvas;
var messageBox;
var debugBox;
var resultBox;

var splashStarted = null;
var splashType = null;

var SplashScreenType = {
    LevelStarted: {
        duration: 2,
        locked: false,
    },
    LevelCompleted: {
        duration: 3,
        locked: true,
    },
    LevelFailed: {
        duration: 3,
        locked: true,
    },
    CampaignCompleted: {
        duration: Infinity,
        locked: false,
    },
};

var gl;
var stencilBuffer;

var colorGenerator;

// Objects holding data for individual shader programs
var circleProgram = {};
var lineProgram = {};

var resolution = 512; // We're assuming a square aspect ratio
var viewPort = {};

var renderScale = 0.9; // means that the coordinate range [-1, 1] will fill 90% of the viewport
                       // the scaling is done in the shaders, but it has to be respected in obtaining coordinates from the mouse position

// Timing
// We need these to fix the framerate
var fps = 60;
var interval = 1000/fps;
var lastTime;

var rootCircle = null;

var cursor = null;

var activeLine = null;
var activeCircle = null;
var activeGeometry = null;

var affectedLeaves = null;

var totalArea;

var enemies;

// Only used for debugging purposes
var markers = [];

var gameMode;

var currentLevel;
var remainingWalls;

var mouseDown = false;
var cursorMoving = false;
var target = null; // The target .toT of the active geometry
var direction = null; // Only necessary for motion around activeCircle
var checkpoints = null;
var nextCheckpoint = null;

window.onload = init;

function init()
{
    canvas = document.getElementById("gl-canvas");

    // This is the size we are rendering to
    viewPort.width = resolution;
    viewPort.height = resolution;
    // This is the actual extent of the canvas on the page
    canvas.style.width = viewPort.width;
    canvas.style.height = viewPort.height;
    // This is the resolution of the canvas (which will be scaled to the extent, using some rather primitive anti-aliasing techniques)
    canvas.width = viewPort.width;
    canvas.height = viewPort.height;

    // By attaching the event to document we can control the cursor from
    // anywhere on the page and can even drag off the browser window.
    document.addEventListener('mousedown', handleMouseDown, false);
    document.addEventListener('mouseup', handleMouseUp, false);
    document.addEventListener('mousemove', handleMouseMove, false);

    messageBox = $('#message');
    debugBox = $('#debug');
    resultBox = $('#result');

    if (!debug)
        renderInstructions();

    gl = WebGLUtils.setupWebGL(canvas, {stencil: true});
    if (!gl) {
        messageBox.html("WebGL is not available!");
    } else {
        messageBox.html("WebGL up and running!");
    }

    if (!debug)
        renderMenu();

    stencilBuffer = new StencilBuffer(gl);

    gl.clearColor(1, 1, 1, 1);

    // Load shaders and get uniform locations
    circleProgram.program = InitShaders(gl, "circle-vertex-shader", "minimal-fragment-shader");
    // add uniform locations
    circleProgram.uRenderScale = gl.getUniformLocation(circleProgram.program, "uRenderScale");
    circleProgram.uCenter = gl.getUniformLocation(circleProgram.program, "uCenter");
    circleProgram.uR = gl.getUniformLocation(circleProgram.program, "uR");
    circleProgram.uFromAngle = gl.getUniformLocation(circleProgram.program, "uFromAngle");
    circleProgram.uToAngle = gl.getUniformLocation(circleProgram.program, "uToAngle");
    // add attribute locations
    circleProgram.aPos = gl.getAttribLocation(circleProgram.program, "aPos");
    circleProgram.aColor = gl.getAttribLocation(circleProgram.program, "aColor");

    // fill uniforms that are already known
    gl.useProgram(circleProgram.program);
    gl.uniform1f(circleProgram.uRenderScale, renderScale);

    lineProgram.program = InitShaders(gl, "line-vertex-shader", "minimal-fragment-shader");
    // add uniform locations
    lineProgram.uRenderScale = gl.getUniformLocation(lineProgram.program, "uRenderScale");
    lineProgram.uAngle = gl.getUniformLocation(lineProgram.program, "uAngle");
    lineProgram.uFromDistance = gl.getUniformLocation(lineProgram.program, "uFromDistance");
    lineProgram.uToDistance = gl.getUniformLocation(lineProgram.program, "uToDistance");
    // add attribute locations
    lineProgram.aPos = gl.getAttribLocation(lineProgram.program, "aPos");
    lineProgram.aColor = gl.getAttribLocation(lineProgram.program, "aColor");

    gl.useProgram(lineProgram.program);
    gl.uniform1f(lineProgram.uRenderScale, renderScale);

    gl.useProgram(null);

    cursor = new Circle(1, 0, 0.025, CircleType.Inside, 0, 2*pi, [0, 0.7, 0]);

    colorGenerator = new ColorGenerator();

    setGameMode(GameMode.ClassicArcade);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    CheckError();

    lastTime = Date.now();
    update();
}

function startSplashScreen(type, message)
{
    splashStarted = Date.now();
    splashType = type;

    resultBox.html(message);
}

function endSplashScreen()
{
    var type = splashType;
    splashStarted = null;
    splashType = null;
    resultBox.html('');
    switch(type)
    {
    case SplashScreenType.LevelStarted:
        break;
    case SplashScreenType.LevelCompleted:
        destroyLevel();
        levelCompleted = false;
        initializeLevel(gameMode, currentLevel+1);
        break;
    case SplashScreenType.LevelFailed:
        destroyLevel();
        initializeLevel(gameMode, 1);
        break;
    case SplashScreenType.CampaignCompleted:
        console.log("Something went wrong, this splash screen should never end!");
        break;
    }
}

function setGameMode(mode)
{
    if (gameMode === mode) return;

    messageBox.find('#'+gameMode).removeClass('active');
    gameMode = mode;
    messageBox.find('#'+gameMode).addClass('active');

    destroyLevel();

    setRemainingWalls(initialWalls);
    initializeLevel(gameMode, 1);
}

function initializeLevel(mode, level)
{
    currentLevel = level;

    switch (mode)
    {
    case GameMode.ClassicArcade:
        initializeClassicArcadeLevel(level);
        break;
    case GameMode.VarietyArcade:
        initializeVarietyArcadeLevel(level);
        break;
    case GameMode.Campaign:
        initializeCampaignLevel(level);
        break;
    }

    totalArea = 0;
    debugBox.find('#area').html(0);
    debugBox.find('#level').html(currentLevel);

    if (debug)
        displayTree();

    startSplashScreen(SplashScreenType.LevelStarted, 'LEVEL ' + currentLevel);
}

function initializeClassicArcadeLevel(level)
{
    var nEnemies = level;

    enemies = [];
    for (var i = 0; i < nEnemies; ++i)
    {
        var type = EnemyTypes[0];
        // This randomisation procedure will generate more enemies
        // in the centre of the arena. This might actually be
        // desirable though.
        var r = Math.random() * (1 - type.radius);
        var phi = Math.random() * 2*pi;
        var angle = Math.random() * 2*pi;
        enemies.push(new Enemy(r*cos(phi), r*sin(phi), type.speed, angle, type.radius));
    }

    if (level === 1)
        setRemainingWalls(initialWalls);
    else
        addWalls(currentLevel + 1);

    initializeRootCircle();
}

function initializeVarietyArcadeLevel(level)
{
    var nEnemies = level;

    enemies = [];
    while (nEnemies > 0 )
    {
        var type;
        do {
            type = EnemyTypes[floor(Math.random()*EnemyTypes.length)];
        } while (type.level > nEnemies);

        // This randomisation procedure will generate more enemies
        // in the centre of the arena. This might actually be
        // desirable though.
        var r = Math.random() * (1 - type.radius);
        var phi = Math.random() * 2*pi;
        var angle = Math.random() * 2*pi;
        enemies.push(new Enemy(r*cos(phi), r*sin(phi), type.speed, angle, type.radius));

        nEnemies -= type.level;
    }

    if (level === 1)
        setRemainingWalls(initialWalls);
    else
        addWalls(currentLevel + 1);

    initializeRootCircle();
}

function initializeCampaignLevel(level)
{
    if (level > CampaignLevels.length)
    {
        console.log('There is no Level ' + level + '! Cheater! Back to Level 1 with you!');
        currentLevel = 1;
        initializeCampaignLevel(currentLevel);
        return;
    }

    var levelData = CampaignLevels[level-1];

    var enemyData;
    if (typeof levelData.enemies === 'function')
        enemyData = levelData.enemies();
    else
        enemyData = levelData.enemies;

    enemies = [];
    for (var i = 0; i < enemyData.length; ++i)
    {
        var enemy = enemyData[i];
        var type = EnemyTypes[enemy.type];

        enemies.push(new Enemy(enemy.x, enemy.y, type.speed, enemy.angle, type.radius));
    }

    initializeRootCircle();

    var wallData;
    if (typeof levelData.walls === 'function')
        wallData = levelData.walls();
    else
        wallData = levelData.walls;

    for (i = 0; i < wallData.length; ++i)
    {
        var geometry;

        if (wallData[i].type === Circle)
        {
            geometry = new Circle(wallData[i].x, wallData[i].y, wallData[i].r);
        }
        else if (wallData[i].type === Line)
        {
            geometry = new Line(wallData[i].angle);
        }

        affectedLeaves = [];
        rootCircle.insert(geometry, affectedLeaves, []);
        for (var j = 0; j < affectedLeaves.length; ++j)
            affectedLeaves[j].subdivide();
    }

    setRemainingWalls(levelData.availableWalls);
}

function initializeRootCircle()
{
    var innerLeafNode = new OpenLeaf(enemies.slice());
    var outerLeafNode = new ClosedLeaf();
    innerLeafNode.area = 1; // we are only interested in the relative area
    outerLeafNode.area = 0; // don't count what's outside the main game arena
    rootCircle = new InnerNode(null, new Circle(0, 0, 1, CircleType.Circumference), 1, innerLeafNode, outerLeafNode);
}

function destroyLevel()
{
    if (rootCircle)
        rootCircle.destroy();
}

function jumpToLevel(n)
{
    destroyLevel();
    initializeLevel(gameMode, n);
}

function setRemainingWalls(n)
{
    remainingWalls = n;
    debugBox.find('#walls').html(remainingWalls);
}

function useWall()
{
    --remainingWalls;
    debugBox.find('#walls').html(remainingWalls);
}

function addWalls(n)
{
    remainingWalls += n;
    debugBox.find('#walls').html(remainingWalls);
}


function renderInstructions()
{
    debugBox.html('Level <span id="level"></span><br>' +
                  'Progress: <span id="area">0</span>%<br>' +
                  'Remaining walls: <span id="walls"></span><br>' +
                  '================================<br><br>' +
                  'Goal:<br><br>' +
                  'Color in 75% of the area!<br><br>' +
                  'How to play:<br>' +
                  '<ul>' +
                  '  <li>Click and hold to lock the green cursor\'s position.' +
                  '  <li>Drag to choose path.' +
                  '  <li>Release to build wall.' +
                  '</ul>' +
                  '<ul class="attention">' +
                  '  <li>Areas that don\'t contain enemies will be colored in.' +
                  '  <li>If the cursor or the wall is hit while a wall is being built, you lose the wall!' +
                  '</ul>');
}

function renderMenu()
{
    var levelList = '';
    for (var i = 1; i <= CampaignLevels.length; ++i)
        levelList += '+ <a id="level' + i + '">Level ' + i + '</a><br>';

    messageBox.html('Switch mode:<br>' +
                    '<br>' +
                    '<a id="classicArcade">Classic Arcade</a><br>' +
                    '<a id="varietyArcade">Variety Arcade</a><br>' +
                    '<a id="campaign">Campaign</a><br>' +
                    levelList);

    var createModeSelectCallback = function(mode) {
        return function(e) { setGameMode(mode); };
    };

    for (var key in GameMode)
    {
        if (!GameMode.hasOwnProperty(key)) continue;

        messageBox.find('#'+GameMode[key]).bind('click', createModeSelectCallback(GameMode[key]));
    }

    var createLevelSelectCallback = function(level) {
        return function(e) {
            setGameMode(GameMode.Campaign);
            jumpToLevel(level);
        };
    };

    for (i = 1; i <= CampaignLevels.length; ++i)
        messageBox.find('#level' + i).bind('click', createLevelSelectCallback(i));
}

function InitShaders(gl, vertexShaderId, fragmentShaderId)
{
    var vertexShader;
    var fragmentShader;

    var vertexElement = document.getElementById(vertexShaderId);
    if(!vertexElement)
    {
        messageBox.html("Unable to load vertex shader '" + vertexShaderId + "'");
        return -1;
    }
    else
    {
        vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexElement.text);
        gl.compileShader(vertexShader);
        if(!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
        {
            messageBox.html("Vertex shader '" + vertexShaderId + "' failed to compile. The error log is:</br>" + gl.getShaderInfoLog(vertexShader));
            return -1;
        }
    }

    var fragmentElement = document.getElementById(fragmentShaderId);
    if(!fragmentElement)
    {
        messageBox.html("Unable to load fragment shader '" + fragmentShaderId + "'");
        return -1;
    }
    else
    {
        fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentElement.text);
        gl.compileShader(fragmentShader);
        if(!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS))
        {
            messageBox.html("Fragment shader '" + fragmentShaderId + "' failed to compile. The error log is:</br>" + gl.getShaderInfoLog(fragmentShader));
            return -1;
        }
    }

    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if(!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        messageBox.html("Shader program failed to link. The error log is:</br>" + gl.getProgramInfoLog(program));
        return -1;
    }

    return program;
}

// This is a fixed-framerate game loop. dT is not constant, though
function update()
{
    window.requestAnimFrame(update, canvas);

    currentTime = Date.now();
    var dTime = currentTime - lastTime;

    if (dTime > interval)
    {
        // Uncomment to see dropped frames
        //frames (dTime > 2*interval) console.log("UpsX" + Math.floor(dTime/interval));

        // The modulo is to take care of the case that we skipped a frame
        lastTime = currentTime - (dTime % interval);

        var steps = floor(dTime / interval);

        if (cursorMoving)
        {
            runMonteCarlo(100);
            moveCursor(steps * interval);
        }

        moveEnemies(steps * interval);

        drawScreen();
    }

    if (!splashStarted && !cursorMoving && remainingWalls === 0)
        startSplashScreen(SplashScreenType.LevelFailed, 'GAME OVER');

    if (splashStarted && currentTime - splashStarted > splashType.duration * 1000)
        endSplashScreen();
}

function drawScreen()
{
    gl.enable(gl.BLEND);

    gl.viewport(0, 0, viewPort.width, viewPort.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    if (activeCircle)
        activeCircle.render(CircleType.Circumference);

    if (activeLine)
        activeLine.render(LineType.Line);

    stencilBuffer.enable();
    rootCircle.render();
    stencilBuffer.disable();

    cursor.render(CircleType.Inside);
    for (var i = 0; i < enemies.length; ++i)
        enemies[i].render();

    if (debug)
        for (i = 0; i < markers.length; ++i)
            markers[i].render(CircleType.Inside);

    gl.disable(gl.BLEND);
}

function moveCursor(dTime)
{
    var dT;

    if (activeGeometry instanceof Circle)
    {
        // ds = r*dtheta --> dtheta = ds / r
        dT = direction * cursorSpeed * dTime / 1000 / activeCircle.r;
    }
    else if (activeGeometry instanceof Line)
    {
        dT = cursorSpeed * dTime / 1000;
    }

    activeGeometry.toT += dT;

    if (nextCheckpoint < checkpoints.length &&
        direction * activeGeometry.toT >= direction * checkpoints[nextCheckpoint].t)
    {
        checkpoints[nextCheckpoint].leaf.subdivide();
        // TODO: We actually only need to look at the subdivided leaf
        // to figure out how the area changed. However, if we do that
        // we lose the gradual refinement of other parts of the tree
        // due to more samples being registered.
        recalculateArea();
        activeGeometry.fromT = checkpoints[nextCheckpoint].t;
        ++nextCheckpoint;
    }

    if (direction * activeGeometry.toT >= direction * target)
    {
        activeGeometry.destroy();
        cursorMoving = false;
    }

    var endPoint = activeGeometry.getEndPoint();
    cursor.x = endPoint.x;
    cursor.y = endPoint.y;

    if (!cursorMoving)
    {
        activeLine = null;
        activeCircle = null;
        activeGeometry = null;

        affectedLeaves = null;
    }
}

function moveEnemies(dTime) {
    for (var j = 0; j < openLeaves.length; ++j)
    {
        var o = openLeaves[j];
        for (var k = 0; k < o.enemies.length; ++k)
        {
            // Move enemies and resolve collisions with walls
            var e = o.enemies[k];

            var dvleft = e.v * dTime / 1000;
            while (dvleft > 1e-6)
            {
                var lastChild = o;
                var nearestN = null;
                var nearestD2 = dvleft*dvleft;
                var nearestR = null;
                var nearestSign = null;
                var nearestAOI = null;

                var currentNode;
                while ((currentNode = lastChild.parent) !== null)
                {
                    // Several of the following calculations change their sign
                    // depending on what side of the geometry they are on
                    var sign;
                    if (lastChild === currentNode.lChild)
                        sign = -1;
                    else
                        sign = 1;

                    if (currentNode.geometry instanceof Circle)
                    {
                        // Compute the distance from the centre of the circle
                        var dx = currentNode.geometry.x - e.x;
                        var dy = currentNode.geometry.y - e.y;
                        var dc = sqrt(dx*dx + dy*dy);

                        // We now transform the collision problem into an equivalent
                        // one where the enemy is just a point and we add its radius
                        // to that of the wall.
                        var r = currentNode.geometry.r + sign * e.geometry.r;
                        var d = sign * (dc - r);

                        // Only look for an intersection we're closer than we can possibly
                        // travel.
                        if (d < dvleft)
                        {
                            // The line (e.x,e.y) + mu (e.vy,e.vy) is the line along which the
                            // enemy moves (with the direction being normalised).

                            // Project the centre of the circle onto that vector (dot product).
                            // Going this distance along the line will lead to the point halfway
                            // between the intersections.
                            var mu = e.vx * dx + e.vy * dy;

                            // Project centre of the circle onto a vector perpendicular to the line.
                            // This will be the perpendicular distance from the line.
                            d = e.vx * dy - e.vy * dx;

                            // Use Pythagoras to get the distance along the line to the two intersections.
                            var dmu = sqrt(r * r - d * d);

                            // Determine vector from enemy to collision coordinates and it's squared length
                            var cx = e.vx * (mu - sign * dmu);
                            var cy = e.vy * (mu - sign * dmu);
                            var c2 = cx * cx + cy * cy;
                            if (c2 < nearestD2)
                            {
                                nearestD2 = c2;
                                nearestR = r;
                                nearestN = currentNode;
                                nearestSign = sign;
                            }
                        }
                    }
                    else
                    {
                        var lAngle = currentNode.geometry.angle;

                        // Create a normalised vector perpendicular to the line.
                        var x = cos(lAngle - sign*pi/2);
                        var y = sin(lAngle - sign*pi/2);

                        // Project the centre and velocity of the enemy onto
                        // that vector (dot product).

                        // This will be the perpendicular distance from the line
                        // taking into account the enemy's radius.
                        var de = x * e.x + y * e.y - e.geometry.r;
                        // This will be negative if we're moving towards the line
                        var dev = x * e.vx + y * e.vy;

                        // Only look for an intersection if we're closer than we can
                        // possibly travel and if we're travelling towards the line.
                        if (dev < 0 && de < dvleft)
                        {
                            // Get angle of incidence (relative to normal)
                            var aoi = lAngle + sign*pi/2 - e.angle;

                            // Get the square of the actual distance to be travelled
                            var d2 = de / cos(aoi);
                            d2 = d2*d2;

                            if (d2 < nearestD2)
                            {
                                nearestD2 = d2;
                                nearestAOI = aoi;
                                nearestSign = sign;
                                nearestN = currentNode;
                            }
                        }
                    }

                    lastChild = currentNode;
                }

                var dv = sqrt(nearestD2);
                e.moveBy(e.vx * dv, e.vy * dv);

                if (nearestN)
                {
                    if (nearestN.geometry instanceof Circle)
                    {
                        // Find vector from geometry centre to collision point
                        var px = nearestSign*(nearestN.geometry.x - e.x);
                        var py = nearestSign*(nearestN.geometry.y - e.y);

                        var dAngle = atan2(py, px) - e.angle;

                        e.setAngle(e.angle + 2*dAngle + pi);

                        /*
                        // Project velocity onto that vector
                        var p = e.vx * px + e.vy * py;

                        // Reflection vector is opposite to twice that projection along
                        // the vector. Also do normalisation now.
                        var rx = px * p/nearestR;
                        var ry = py * p/nearestR;
                        e.vx -= 2*rx;
                        e.vy -= 2*ry;
                        */
                    }
                    else
                    {
                        e.setAngle(e.angle + 2*nearestAOI + pi);
                    }
                }

                dvleft -= dv;
            }

            // Check for collisions with moving cursor or growing geometry
            if (cursorMoving)
            {
                if (e.geometry.collidesWith(cursor))
                    abortNewGeometry();

                if (o.geometry && e.geometry.collidesWith(o.geometry))
                {
                    if (activeCircle)
                    {
                        // Get angle of intersection
                        var xp = e.x - activeCircle.x;
                        var yp = e.y - activeCircle.y;

                        var iAngle = atan2(yp, xp);

                        // Make sure the distance between fromT and iAngle is less than pi
                        if (iAngle - activeCircle.fromT > pi)
                            iAngle -= 2*pi;
                        else if (iAngle - activeCircle.fromT < -pi)
                            iAngle += 2*pi;

                        // Take care of the fact that toT can be growing in the positive
                        // or the negative direction.
                        if (iAngle > activeCircle.fromT && iAngle < activeCircle.toT ||
                            iAngle < activeCircle.fromT && iAngle > activeCircle.toT
                        ) {
                            abortNewGeometry();
                        }
                    }
                    else
                    {
                        // Get position of enemy along line by projection
                        var lx = cos(activeLine.angle);
                        var ly = sin(activeLine.angle);

                        var emu = lx*e.x + ly*e.y;

                        if (emu < activeLine.toT)
                            abortNewGeometry();
                    }
                }
            }
        }
    }
}

function abortNewGeometry() {
    cursorMoving = false;

    var endPoint;
    if (activeCircle)
    {
        activeCircle.toT = target;
        endPoint = activeCircle.getEndPoint();
        activeCircle.destroy();
        activeCircle = null;
    }
    else
    {
        activeLine.toT = target;
        endPoint = activeLine.getEndPoint();
        activeLine.destroy();
        activeLine = null;
    }

    cursor.x = endPoint.x;
    cursor.y = endPoint.y;

    // All leaves share the same geometry object
    if (nextCheckpoint === 0 && affectedLeaves.length)
        affectedLeaves[0].geometry.destroy();

    for (var i = 0; i < affectedLeaves.length; ++i)
    {
        affectedLeaves[i].geometry = null;
        affectedLeaves[i].lChildSamples = 0;
        affectedLeaves[i].rChildSamples = 0;
    }

    affectedLeaves = null;
}

function handleMouseMove(event) {
    if (cursorMoving)
        return;

    var rect = canvas.getBoundingClientRect();
    var coords = normaliseCursorCoordinates(event, rect);

    if (debug)
    {
        debugBox.find('#xcoord').html(coords.x);
        debugBox.find('#ycoord').html(coords.y);
    }

    if (mouseDown)
    {
        if (snapToLine(coords.x, coords.y))
        {
            activeCircle.hide();
            activeLine.show();
        }
        else
        {
            activeCircle.show();
            activeLine.hide();

            // Calculate position of the circle, based on cursor
            // and mouse position.

            var mu = (pow(cursor.x - coords.x, 2) + pow(cursor.y - coords.y, 2)) / (cursor.x * coords.y - cursor.y * coords.x);

            var x = cursor.x - mu * cursor.y / 2;
            var y = cursor.y + mu * cursor.x / 2;

            activeCircle.move(x, y);

            activeCircle.resize(sqrt(pow(x - cursor.x, 2) + pow(y - cursor.y, 2)));
        }
    }
    else
    {
        var angle = atan2(coords.y, coords.x);

        cursor.move(cos(angle), sin(angle));
    }
}

function handleMouseDown(event) {
    if (cursorMoving ||
        splashType && splashType.locked)
        return;

    var rect = canvas.getBoundingClientRect();
    var coords = normaliseCursorCoordinates(event, rect);

    if (coords.x < -1.1 || coords.x > 1.1 || coords.y < -1.1 || coords.y > 1.1)
        return;

    if (debug)
    {
        debugBox.find('#xdown').html(coords.x);
        debugBox.find('#ydown').html(coords.y);
    }

    mouseDown = true;
    activeLine = new Line(atan2(-cursor.y, -cursor.x), LineType.Line, -1, 1, [0,0,0]);

    // This position is arbitrary. When the user clicks, the
    // line will always be shown and the circles parameters
    // will be recalculated as soon as the mouse is moved.
    activeCircle = new Circle(cursor.x, cursor.y, 0.2, CircleType.Circumference, 0, 2*pi, [0,0,0]);
    activeCircle.hide();
}

function handleMouseUp(event) {
    if (cursorMoving ||
        splashType && splashType.locked ||
        (!activeCircle && !activeLine))
        return;

    var rect = canvas.getBoundingClientRect();
    var coords = normaliseCursorCoordinates(event, rect);

    if (debug)
    {
        debugBox.find('#xup').html(coords.x);
        debugBox.find('#yup').html(coords.y);
    }

    mouseDown = false;

    var newColor = colorGenerator.nextColor(true);
    newColor =  [newColor.red()/255, newColor.green()/255, newColor.blue()/255];

    var newGeometry;
    var intersections = [];

    // The ordering of intersections will depend on the direction in which
    // the cursor grows.
    if (!activeCircle.hidden)
    {
        activeLine.destroy();
        activeLine = null;
        var points = activeCircle.intersectionsWith(rootCircle.geometry);

        // Get squared distance from one point to cursor
        var dx = points[0].x - cursor.x;
        var dy = points[0].y - cursor.y;
        var d2 = dx*dx + dy*dy;

        // Check which point corresponds to the cursor and set fromT and toT accordingly
        if (d2 < 1e-10)
        {
            activeCircle.fromT = atan2(points[0].y - activeCircle.y, points[0].x - activeCircle.x);
            target = atan2(points[1].y - activeCircle.y, points[1].x - activeCircle.x);
        }
        else
        {
            activeCircle.fromT = atan2(points[1].y - activeCircle.y, points[1].x - activeCircle.x);
            target = atan2(points[0].y - activeCircle.y, points[0].x - activeCircle.x);
        }

        // Make sure the distance between fromT and toT is less than pi (otherwise we
        // might go around the circle in the wrong direction)
        if (target - activeCircle.fromT > pi)
            target -= 2*pi;
        else if (target - activeCircle.fromT < -pi)
            target += 2*pi;

        // Determine sense of movement
        direction = sign(target - activeCircle.fromT);

        newGeometry = new Circle(
            activeCircle.x,
            activeCircle.y,
            activeCircle.r,
            activeCircle.type,
            activeCircle.fromT,
            target,
            newColor
        );

        activeGeometry = activeCircle;
    }
    else
    {
        activeCircle.destroy();
        activeCircle = null;
        target = 1;

        // Not necessary for movement, but for ordering of intersections
        direction = +1;

        newGeometry = new Line(
            activeLine.angle,
            activeLine.type,
            activeLine.fromT,
            target,
            newColor
        );

        activeGeometry = activeLine;
    }

    intersections.push(activeGeometry.fromT);
    intersections.push(target);

    affectedLeaves = [];
    rootCircle.insert(newGeometry, affectedLeaves, intersections);
    intersections.sort(function(a,b) {
        return direction * (a-b);
    });

    checkpoints = [];

    // We are now processing each adjacent pair of intersections. The
    // latter point in a pair is the more interesting one, so i will
    // refer to that one.
    for (var i = 1; i < intersections.length; ++i)
    {
        // Get a point halfway between the two intersections.
        var t = (intersections[i-1] + intersections[i]) / 2;

        // Now we (ab)use getEndPoint() of the active geometry to
        // turn this number into a 2D point.
        var probe;
        activeGeometry.toT = t;
        probe = activeGeometry.getEndPoint();

        // Now we use that point to probe the tree and see which leaf
        // it lies in.
        var leaf = rootCircle.probeTree(probe.x, probe.y);

        // Is this lands in an open leaf than the latter intersection of
        // the current pair acts as a checkpoint for that leaf.
        if (leaf instanceof OpenLeaf)
            checkpoints.push({
                t:    intersections[i],
                leaf: leaf,
            });
    }

    // Fix the end point of the active geometry.
    activeGeometry.toT = activeGeometry.fromT;

    // TODO: We should really avoid ever starting in this case
    if (checkpoints.length)
        useWall();

    cursorMoving = true;

    nextCheckpoint = 0;
}

// Takes the mouse event and the rectangle to normalise for
// Outputs object with x, y coordinates in [-1,1] with positive
// y pointing upwards.
function normaliseCursorCoordinates(event, rect)
{
    return {
        x: (2*(event.clientX - rect.left) / resolution - 1) / renderScale,
        y: (1 - 2*(event.clientY - rect.top) / resolution) / renderScale, // invert, to make positive y point upwards
    };
}

// Determines if cursor and mouse are sufficiently closely aligned
// to snap to a straight line. Parameters are the coordinates of the
// mouse.
function snapToLine(x, y) {
    if (!activeLine)
        return false;

    // The angle of the line from the cursor to the mouse.
    var pointedAngle = atan2(y - cursor.y, x - cursor.x);

    // There is a branch cut at an angle of +/- pi, which means
    // that if the two angles are really close, but one in the 2nd
    // and one in the third quadrant, their difference will erroneously
    // be about 2pi. To fix this, we modify the pointed angle accordingly.
    // We actually reduce the difference below pi/2, because an angle
    // difference of pi is also (anti)parallel.

    while (pointedAngle - activeLine.angle > pi/2)
        pointedAngle -= pi;
    while (pointedAngle - activeLine.angle < -pi/2)
        pointedAngle += pi;

    // Snap if we're less than 5 degrees away the line
    return abs(pointedAngle - activeLine.angle) < 2 * pi / 180;
}

// n is the number of samples to generate
function runMonteCarlo(n) {
    for (var i = 0; i < n; ++i)
    {
        // Generate points uniformly in coordinate range [-1,1]
        var x = Math.random()*2-1;
        var y = Math.random()*2-1;
        // Ignore points that are not inside the unit circle
        if (x*x + y*y <= 1)
            rootCircle.registerSample(x, y);
    }
}

function recalculateArea()
{
    var newArea = rootCircle.recalculateAreas();
    if (newArea - totalArea > 0.01)
    {
        totalArea = newArea;
        debugBox.find('#area').html((totalArea*100).toFixed());
    }
    if (debug) displayTree();

    if ((totalArea*100).toFixed() >= 75)
    {
        if (gameMode === GameMode.Campaign &&
            currentLevel === CampaignLevels.length)
            startSplashScreen(SplashScreenType.CampaignCompleted, 'CAMPAIGN<br>COMPLETED');
        else
            startSplashScreen(SplashScreenType.LevelCompleted, 'YOU WIN');
    }

}

function displayTree()
{
    debugBox.find('#kdtree').html(rootCircle.toString().replace(/\n/g, '<br>'));
}

function CheckError(msg)
{
    var error = gl.getError();
    if (error !== 0)
    {
        var errMsg = "OpenGL error: " + error.toString(16);
        if (msg) { errMsg = msg + "</br>" + errMsg; }
        messageBox.html(errMsg);
    }
}
