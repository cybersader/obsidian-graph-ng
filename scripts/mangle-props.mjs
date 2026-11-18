/** Main-bundle-only private member names that esbuild may shorten. Each name is checked by
 * tests/gates.test.ts: absent from DOM/ES/Obsidian typings, the worker's sources, e2e/scripts and
 * string literals and declared settings keys. Compiled tests resolve private names through the
 * emitted cache; host APIs, worker messages and persisted keys retain their original spelling. */
export const MANGLED_PROPS = ['onViewStateChange', 'tuneViewState', 'showViewGroups', 'stateStrip', 'stateStamp', 'namedViewState', 'leaveViewState', 'switchViewState', 'syncViewState', 'appearanceSections', 'appearanceOpen', 'appearanceState', 'currentViewState', 'updateViewState', 'showAppearance', 'focusAppearance', 'appearanceSection', 'layoutActive', 'buildProgress', 'followLayout', 'layoutSettled', 'relationPending', 'isolationEdges', 'layoutWorking', 'labelsPending', 'densityFrame', 'edgeWidth', 'appliedView', 'frameSelection', 'memberQuery', 'layoutRatio', 'queuedRefresh', 'memberRoot', 'viewOrigin', 'refreshWork', 'moreControl', 'followExtent', 'editCrumbs', 'carrierGeometry', 'carrierShown', 'lineTarget', 'lineOwner', 'carrierTier', 'baseNodeRadius', 'queueSizingLabels', 'labelCarrierSize', 'expressionPanelId', 'expressionTimers', 'workspaceButton', 'cameraFrame', 'coordinateRevision', 'uploadCoordinates', 'uploadDiscs', 'lastPointer', 'physicsDraft', 'physicsError', 'physicsBusy', 'preparePositions', 'propertyVerified', 'factsComplete', 'propertySource', 'propertyRevision', 'setPropertySource', 'verifyProperties', 'promoteProperties', 'watchProperties', 'linksPending', 'visibleCarriers', 'openSections', 'groupPalette', 'dirty', 'worldPoint', 'waitForResize', 'viewNamespace', 'viewIdentity', 'vaos', 'uploadView', 'uploadPalette', 'uploadLabels', 'themeCache', 'stateBytes', 'setFocus', 'setColors', 'seedComplete', 'searchTimer', 'saveTimer', 'restoreTimer', 'restoreCamera', 'renderView', 'renderRevision', 'renderContributionPanel', 'reloadRequired', 'refreshOnce', 'recolor', 'provisional', 'programs', 'prepareLabels', 'predicateForm', 'positionHeight', 'pointerUp', 'pointerMove', 'pointerLeave', 'pointerDown', 'pointerCancel', 'placeOverlay', 'pickEdge', 'pendingCamera', 'paginate', 'packState', 'packDiscs', 'onZoomOut', 'onUnavailable', 'onNode', 'onGroup', 'onEdge', 'nodeAt', 'labelVaos', 'labelsRevision', 'labelBuffers', 'hoverLabel', 'homeRatio', 'groupRgb', 'groupLimit', 'groupGeneration', 'groupCount', 'groupColors', 'focusTarget', 'focusLevel', 'focusGroup', 'focusAt', 'flight', 'filterVisible', 'exploring', 'exploreQueued', 'explorePanel', 'edgeOn', 'edgeList', 'edgeAt', 'drill', 'drawCanvas', 'downY', 'downX', 'discData', 'discBuffers', 'detailScope', 'derivedForm', 'contributionScope', 'contributionPage', 'contributionContext', 'contextLost', 'colorOf', 'colorBytes', 'clampRatio', 'choosePolicy', 'changeVersion', 'carrierLookup', 'canvasEdges', 'viewSource', 'edgeTier', 'tierEdges', 'tierPartial', 'uploadTiers', 'emphasize', 'noteCaption', 'keyDown', 'noteCard', 'selectNote', 'savedSettings', 'statsCache', 'suggestBusy', 'suggestPreview', 'suggestMessage', 'commitCandidate', 'edgeAnchor', 'edgeToken', 'tierSource', 'edgeParallels', 'selectEdge', 'cycleEdge', 'edgeDrawn', 'selectedEdges', 'describeEdges', 'tierTotals', 'directs', 'pipXY', 'pipTargets', 'pipEls', 'legendRows', 'legendCounts', 'pipParts', 'rippleEl', 'updateLegend', 'panTo', 'startRipple', 'placeHighlights', 'drawnRadius', 'pickTiered', 'ripple', 'labelLevel', 'lodLevel', 'moreAt', 'moreButton', 'rankedLabels', 'anchorPool', 'anchorKey', 'anchorNames', 'anchorPrevious', 'placeAnchored', 'tierLeaders', 'baseVisible', 'cardAction', 'cardHost', 'cardRect', 'cueLine', 'cueRing', 'frameNodes', 'isolationBar', 'isolationMask', 'showIsolation', 'travel', 'animateLens', 'layoutLens', 'lensButton', 'lensBytes', 'lensLabelWidth', 'lensMotion', 'lensPoints', 'lensRadius', 'lensRevision', 'lensRows', 'lensWanted', 'rebuildLens', 'renderCoordinate', 'uploadLens', 'lensChanged', 'lensToggle', 'cardKeyDown', 'replayHover', 'stopFlight', 'panBy', 'zoomAt', 'openHub', 'openable', 'edgeCard', 'cardNode', 'focusCanvas', 'cardStep', 'cardKey', 'setHover', 'interestOf', 'interestMemo', 'findBox', 'findInput', 'findList', 'findStatus', 'findRing', 'findHits', 'findActive', 'findTimer', 'findToken', 'findId', 'findSource', 'findOpen', 'findShow', 'findClose', 'findSearch', 'findPaint', 'findPreview', 'findGo', 'findKey', 'flyToNote', 'gestures', 'showMenu', 'pathView', 'pathMarks', 'nextPath', 'showPath', 'placePath', 'findPath', 'miniMap', 'crumbTrail', 'limitChip', 'returnTo', 'pendingFocus', 'toGroups', 'focusNote', 'fitting', 'worldW', 'worldH', 'miniDrawn', 'miniBuilt', 'miniTimer', 'rebuildDensity', 'densityCanvas', 'miniLast', 'panCamera', 'fitCamera', 'miniKey', 'miniCanvas', 'densityVersion', 'miniFrame', 'crumbKey', 'crumbName', 'travelBy', 'clearTrail', 'findKeys', 'miniToggle', 'miniFolded', 'miniShown', 'miniHeld', 'paintToggle', 'clearCrumbs', 'informationActions', 'vaultCount', 'toggleKey', 'filterToggles', 'navSections', 'navQuery', 'navOpen', 'navClosed', 'navPages', 'navGroupLimit', 'navList', 'navInput', 'navStatus', 'navId', 'paintConnections', 'navSecond', 'disclosed', 'panels', 'panelRects', 'panelObserver', 'measurePanels', 'hoverBox', 'moreSize', 'moreTotal', 'frontier', 'frontierBadges', 'neighbourhoodPartial', 'expandNeighbourhood', 'pendingPropertyPaths', 'propertyAudit', 'propertyAuditAgain', 'propertyAuditRefresh', 'propertyAuditImmediate', 'propertyAuditWake',
  // Additional private class state; settings and message keys are never eligible.
  'viewCollision', 'statusSummary', 'viewMessage', 'sizingMessage', 'viewBusy', 'sizingSettings',
  'nodePreview', 'sizingBusy', 'closeButton', 'sizingPreview', 'relationMessage', 'viewFeedback', 'layoutControl', 'layoutStop',
  'exploreRequest', 'updateSizingRange', 'viewFeedbackText', 'saveFocus', 'viewDraft', 'physicsUndo',
  'viewConfiguration', 'exploreCompletion', 'cardInset', 'toolsInset', 'tierLabels', 'expressionField',
  'setQuery', 'tool', 'physicsNote', 'sizingTimer', 'viewSaved', 'centerX',
  'centerY', 'drafts', 'navTimer', 'sizingOutput', 'relationBusy', 'hoverFx',
  'rankedKey', 'sizingDraft', 'openRequest', 'admitDetail', 'representations', 'physicsAdvanced',
  'viewDefinition', 'miniWanted', 'saveViewDraft', 'detailVisible', 'menuToken', 'noteCount',
  'navShown', 'hoverHub', 'sizingRange', 'uploadSizes', 'centreOn', 'relationshipDisplay',
  'endPreview', 'guards', 'memberList', 'previewExpression', 'toolTitle', 'scopeName',
  'findReset', 'edgeQuiet', 'viewOpen', 'toolsOverlap', 'miniChanged', 'adaptSizes',
  'placeCard', 'densityBuffer', 'densitySize', 'densityReady', 'densityTarget',
  // Main-realm panel/renderer callbacks, never host API methods or persisted data.
  'previewSizing', 'updateSizingReadout', 'updateLensControl', 'previewSuggestions', 'visualsChanged', 'applySuggestions',
  'toggleLens', 'setRelationshipDisplay', 'commitSavedView', 'savedViewIssue', 'onSizingChange', 'sizingReadout',
  'openSavedView', 'onLensChange', 'toolsChanged', 'relationshipNodes',
  // Internal lifecycle, presentation and interaction state. Keep dataset/timing names,
  // optional host property-facts fields and legacy settings migration keys readable.
  'detailFallback', 'linksResolved', 'ingestedHash', 'pendingProperties', 'showDetails',
  'invalidate', 'hoveredEdge', 'rememberPresentation', 'emphasisBudget', 'setLens',
  'onMoreConnections', 'invalidateSource', 'viewDefinitions', 'openNote', 'relations',
  'syncTools', 'lineRanks', 'lensNode', 'linkProducer', 'readProgress', 'motionMedia',
  'previewSettings', 'resetStore', 'saveSoon', 'typeHidden', 'motionChanged', 'focusFrom',
  'negated', 'progressText', 'legendCount', 'applyLayout', 'applySizing', 'contextMenu',
  'emphasisDim', 'progressAt', 'heldBudget', 'pickHub', 'commitSuggestions', 'noteTitle',
  'streamPositions', 'showConnections', 'disclose', 'syncLens', 'heads', 'findBlur',
  'updateSummary', 'layoutAdvice', 'resetAdapter', 'commitSizing', 'nextRevision',
  'commitLayout', 'guard', 'focusFilter', 'lensed', 'scoped', 'exclusions', 'canvasOnly',
  'frameGroup', 'clearHover', 'sector', 'maxDegree', 'stale', 'stats', 'onHub', 'discs',
  'apriori', 'showAll', 'partial', 'seen', 'scales', 'act', 'trail', 'slots',
  // Main-realm upload helpers, transient panel callbacks and renderer state.
  'arrayData', 'textureUnit', 'textureFilter', 'floatAttribute', 'layoutFrame',
  'confirmRelationshipDisplay', 'browseGroups', 'sentComplete', 'adoptCamera',
  'beginLayout', 'averageDegree', 'viewCurrent', 'hasPending', 'openGroup',
  'canTravel', 'hubRatio', 'contributionHeading',
  // Startup-cache lifecycle only; on-disk fields and deviceNamespace stay literal.
  'syncRooms', 'roomRevision', 'prunePartitions', 'unknownRooms', 'onRoomSettled',
  'roomBudget', 'savedOwners', 'loadProperties', 'auditPath', 'storageError', 'loadRoom', 'saveRoom',
  'attachFactCache', 'cacheScope', 'cacheTurn', 'factVersion', 'savedVersion',
  'restoreFacts', 'saveFacts', 'clearFacts', 'savedFacts', 'retireSaved', 'savedCopy',
  'rejectSaved', 'purgeFacts', 'cacheStatus', 'factError', 'factDirectory', 'factStore', 'deadlineMs', 'cacheKey'];
export const mangleProps = new RegExp(`^(?:${MANGLED_PROPS.join('|')})$`);
