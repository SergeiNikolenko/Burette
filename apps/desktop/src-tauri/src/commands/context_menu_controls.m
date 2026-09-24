// Live controls embedded in native context menus: a slider row and a colour
// carousel with an inline hue picker. Both report every change through a C
// callback while the menu stays open, so the caller can apply it immediately.
//
// The views sit on the same grid as standard NSMenuItems: the image column is
// centred at ~20 pt and the title starts at ~36 pt, and a menu that shows a
// checkmark anywhere shifts both by one state column.

#import <AppKit/AppKit.h>

typedef void (*BuretteMenuValueCallback)(void *context, const char *itemId, double number, const char *colour);

static const CGFloat BuretteMenuRowWidth = 236;
static const CGFloat BuretteMenuTrailing = 14;

static BOOL BuretteMenuHasStateColumn(NSMenuItem *item) {
    for (NSMenuItem *sibling in item.menu.itemArray) {
        if (sibling.state != NSControlStateValueOff) return YES;
    }
    return NO;
}

static CGFloat BuretteMenuIconCentre(NSMenuItem *item) {
    return BuretteMenuHasStateColumn(item) ? 37.5 : 22;
}

static CGFloat BuretteMenuTitleLeading(NSMenuItem *item) {
    return BuretteMenuHasStateColumn(item) ? 52.5 : 37;
}

static NSString *BuretteHexColour(NSColor *colour) {
    NSColor *rgb = [colour colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    return [NSString stringWithFormat:@"#%02x%02x%02x",
            (int)lround(rgb.redComponent * 255), (int)lround(rgb.greenComponent * 255), (int)lround(rgb.blueComponent * 255)];
}

static NSColor *BuretteColourFromHex(NSString *hex) {
    NSString *digits = [hex hasPrefix:@"#"] ? [hex substringFromIndex:1] : hex;
    if (digits.length != 6) return nil;
    unsigned value = 0;
    if (![[NSScanner scannerWithString:digits] scanHexInt:&value]) return nil;
    return [NSColor colorWithSRGBRed:((value >> 16) & 0xff) / 255.0
                               green:((value >> 8) & 0xff) / 255.0
                                blue:(value & 0xff) / 255.0
                               alpha:1];
}

// MARK: - Slider

@interface BuretteMenuSliderView : NSView
@end

@implementation BuretteMenuSliderView {
    NSString *_itemId;
    NSImageView *_icon;
    NSTextField *_label;
    NSSlider *_slider;
    NSTextField *_valueLabel;
    double _step;
    NSString *_unit;
    BuretteMenuValueCallback _callback;
    void *_context;
}

- (instancetype)initWithId:(NSString *)itemId title:(NSString *)title symbol:(NSString *)symbol
                     value:(double)value min:(double)min max:(double)max step:(double)step unit:(NSString *)unit
                  callback:(BuretteMenuValueCallback)callback context:(void *)context {
    self = [super initWithFrame:NSMakeRect(0, 0, BuretteMenuRowWidth, 26)];
    if (!self) return nil;
    _itemId = [itemId copy];
    _step = step;
    _unit = [unit copy];
    _callback = callback;
    _context = context;
    self.autoresizingMask = NSViewWidthSizable;

    NSImage *image = symbol.length ? [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:title] : nil;
    _icon = [NSImageView imageViewWithImage:image ?: [[NSImage alloc] init]];
    _icon.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:12 weight:NSFontWeightRegular];
    _icon.contentTintColor = NSColor.labelColor;
    _label = [NSTextField labelWithString:title];
    _label.font = [NSFont menuFontOfSize:0];
    _label.lineBreakMode = NSLineBreakByTruncatingTail;
    _slider = [NSSlider sliderWithValue:value minValue:min maxValue:max target:self action:@selector(changed:)];
    _slider.controlSize = NSControlSizeMini;
    _slider.continuous = YES;
    _valueLabel = [NSTextField labelWithString:@""];
    _valueLabel.font = [NSFont monospacedDigitSystemFontOfSize:NSFont.smallSystemFontSize weight:NSFontWeightRegular];
    _valueLabel.textColor = NSColor.secondaryLabelColor;
    _valueLabel.alignment = NSTextAlignmentRight;
    [self showValue:value];

    for (NSView *view in @[_icon, _label, _slider, _valueLabel]) {
        view.translatesAutoresizingMaskIntoConstraints = NO;
        [self addSubview:view];
    }
    [NSLayoutConstraint activateConstraints:@[
        [_icon.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
        [_label.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
        [_label.widthAnchor constraintEqualToConstant:64],
        [_slider.leadingAnchor constraintEqualToAnchor:_label.trailingAnchor constant:6],
        [_slider.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
        [_valueLabel.leadingAnchor constraintEqualToAnchor:_slider.trailingAnchor constant:6],
        [_valueLabel.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-BuretteMenuTrailing],
        [_valueLabel.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
        [_valueLabel.widthAnchor constraintEqualToConstant:38],
    ]];
    return self;
}

// The menu decides whether it shows a state column only once it is populated.
- (void)viewWillMoveToWindow:(NSWindow *)window {
    [super viewWillMoveToWindow:window];
    NSMenuItem *item = self.enclosingMenuItem;
    if (!item) return;
    for (NSLayoutConstraint *constraint in self.constraints) {
        if (constraint.identifier) [self removeConstraint:constraint];
    }
    NSLayoutConstraint *icon = [_icon.centerXAnchor constraintEqualToAnchor:self.leadingAnchor constant:BuretteMenuIconCentre(item)];
    NSLayoutConstraint *label = [_label.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:BuretteMenuTitleLeading(item)];
    icon.identifier = @"column";
    label.identifier = @"column";
    [NSLayoutConstraint activateConstraints:@[icon, label]];
}

- (void)showValue:(double)value {
    NSInteger decimals = _step >= 1 ? 0 : MIN(3, (NSInteger)ceil(-log10(_step > 0 ? _step : 0.01)));
    NSString *number = [NSString stringWithFormat:@"%.*f", (int)decimals, value];
    _valueLabel.stringValue = _unit.length ? [number stringByAppendingString:_unit] : number;
}

- (void)changed:(NSSlider *)sender {
    double value = sender.doubleValue;
    if (_step > 0) value = round(value / _step) * _step;
    [self showValue:value];
    if (_callback) _callback(_context, _itemId.UTF8String, value, NULL);
}

@end

// MARK: - Colour carousel

// Scroll (wheel or trackpad) or drag to browse, click to pick. The eyedropper
// swaps the carousel for a hue strip that is dragged or scrolled left and right.
@interface BuretteMenuColourView : NSView
@end

@implementation BuretteMenuColourView {
    NSString *_itemId;
    NSArray<NSColor *> *_swatches;
    NSInteger _selected;
    BOOL _picking;
    CGFloat _hue;
    CGFloat _offset;
    BOOL _dragging;
    BOOL _dragMoved;
    CGFloat _dragStartX;
    CGFloat _dragStartOffset;
    BuretteMenuValueCallback _callback;
    void *_context;
}

static const CGFloat BuretteSwatchDiameter = 16;
static const CGFloat BuretteSwatchPitch = 23;
static const CGFloat BuretteSwatchFade = 18;

- (instancetype)initWithId:(NSString *)itemId colours:(NSArray<NSColor *> *)colours active:(NSColor *)active
                  callback:(BuretteMenuValueCallback)callback context:(void *)context {
    self = [super initWithFrame:NSMakeRect(0, 0, BuretteMenuRowWidth, 30)];
    if (!self) return nil;
    _itemId = [itemId copy];
    _callback = callback;
    _context = context;
    _hue = 0.55;
    self.autoresizingMask = NSViewWidthSizable;

    // The caller's palette comes first; three tones of an 18-step hue wheel follow.
    NSMutableArray<NSColor *> *swatches = [colours mutableCopy];
    const CGFloat tones[3][2] = {{0.32, 0.97}, {0.62, 0.92}, {0.85, 0.72}};
    for (int tone = 0; tone < 3; tone++) {
        for (int step = 0; step < 18; step++) {
            [swatches addObject:[NSColor colorWithHue:step / 18.0 saturation:tones[tone][0] brightness:tones[tone][1] alpha:1]];
        }
    }
    _swatches = swatches;
    _selected = -1;
    NSString *activeHex = active ? BuretteHexColour(active) : nil;
    for (NSUInteger index = 0; activeHex && index < swatches.count; index++) {
        if ([BuretteHexColour(swatches[index]) isEqualToString:activeHex]) {
            _selected = (NSInteger)index;
            break;
        }
    }
    return self;
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }

- (void)viewWillMoveToWindow:(NSWindow *)window {
    [super viewWillMoveToWindow:window];
    // Bring the chosen swatch into view when the menu opens.
    if (_selected > 0) [self setOffset:_selected * BuretteSwatchPitch - NSWidth(self.stripRect) / 2];
}

- (NSRect)eyedropperRect {
    return NSMakeRect(NSMaxX(self.bounds) - BuretteMenuTrailing - 20, NSMidY(self.bounds) - 10, 20, 20);
}

- (NSRect)stripRect {
    NSMenuItem *item = self.enclosingMenuItem;
    CGFloat minX = (item ? BuretteMenuIconCentre(item) : 22) - BuretteSwatchDiameter / 2 - 3;
    return NSMakeRect(minX, 0, NSMinX(self.eyedropperRect) - 10 - minX, NSHeight(self.bounds));
}

- (NSRect)hueTrack {
    return NSInsetRect(self.stripRect, 9, 0);
}

- (CGFloat)maxOffset {
    CGFloat content = _swatches.count * BuretteSwatchPitch - (BuretteSwatchPitch - BuretteSwatchDiameter);
    return MAX(0, content - NSWidth(self.stripRect) + 6);
}

- (NSColor *)hueColour {
    return [NSColor colorWithHue:_hue saturation:0.62 brightness:0.9 alpha:1];
}

- (void)drawRect:(NSRect)dirtyRect {
    [NSGraphicsContext saveGraphicsState];
    [[NSBezierPath bezierPathWithRect:self.stripRect] addClip];
    if (_picking) [self drawHueStrip]; else [self drawSwatches];
    [NSGraphicsContext restoreGraphicsState];
    [self drawEyedropper];
}

- (void)drawSwatches {
    NSRect strip = self.stripRect;
    CGFloat r = BuretteSwatchDiameter / 2;
    CGFloat maxOffset = self.maxOffset;
    for (NSUInteger index = 0; index < _swatches.count; index++) {
        CGFloat x = NSMinX(strip) + 3 + r + index * BuretteSwatchPitch - _offset;
        CGFloat y = NSMidY(self.bounds);
        if (x < NSMinX(strip) - BuretteSwatchPitch || x > NSMaxX(strip) + BuretteSwatchPitch) continue;
        // Fade swatches into the edges only where there is more to scroll to.
        CGFloat alpha = 1;
        if (_offset > 0) alpha = MIN(alpha, (x - NSMinX(strip)) / BuretteSwatchFade);
        if (_offset < maxOffset) alpha = MIN(alpha, (NSMaxX(strip) - x) / BuretteSwatchFade);
        alpha = MAX(0, alpha);

        [[_swatches[index] colorWithAlphaComponent:alpha] setFill];
        [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(x - r, y - r, 2 * r, 2 * r)] fill];
        NSBezierPath *rim = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(x - r + 0.25, y - r + 0.25, 2 * r - 0.5, 2 * r - 0.5)];
        rim.lineWidth = 0.5;
        [[NSColor.blackColor colorWithAlphaComponent:0.18 * alpha] setStroke];
        [rim stroke];
        if ((NSInteger)index == _selected) {
            NSBezierPath *ring = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(x - r - 3, y - r - 3, 2 * r + 6, 2 * r + 6)];
            ring.lineWidth = 1.5;
            [[NSColor.labelColor colorWithAlphaComponent:alpha] setStroke];
            [ring stroke];
        }
    }
}

- (void)drawHueStrip {
    NSRect track = self.hueTrack;
    NSRect bar = NSMakeRect(NSMinX(track), NSMidY(self.bounds) - 5, NSWidth(track), 10);
    NSMutableArray<NSColor *> *colours = [NSMutableArray array];
    for (int step = 0; step <= 12; step++) {
        [colours addObject:[NSColor colorWithHue:step / 12.0 saturation:0.62 brightness:0.9 alpha:1]];
    }
    [[[NSGradient alloc] initWithColors:colours] drawInBezierPath:[NSBezierPath bezierPathWithRoundedRect:bar xRadius:5 yRadius:5] angle:0];

    CGFloat x = NSMinX(track) + _hue * NSWidth(track);
    NSRect knob = NSMakeRect(x - 9, NSMidY(self.bounds) - 9, 18, 18);
    [NSGraphicsContext saveGraphicsState];
    NSShadow *shadow = [[NSShadow alloc] init];
    shadow.shadowColor = [NSColor.blackColor colorWithAlphaComponent:0.35];
    shadow.shadowBlurRadius = 3;
    shadow.shadowOffset = NSMakeSize(0, -1);
    [shadow set];
    [NSColor.whiteColor setFill];
    [[NSBezierPath bezierPathWithOvalInRect:knob] fill];
    [NSGraphicsContext restoreGraphicsState];
    [self.hueColour setFill];
    [[NSBezierPath bezierPathWithOvalInRect:NSInsetRect(knob, 2.5, 2.5)] fill];
}

- (void)drawEyedropper {
    NSRect rect = self.eyedropperRect;
    if (_picking) {
        [NSColor.controlAccentColor setFill];
        [[NSBezierPath bezierPathWithOvalInRect:NSInsetRect(rect, -2, -2)] fill];
    }
    NSImageSymbolConfiguration *config = [[NSImageSymbolConfiguration configurationWithPointSize:12 weight:NSFontWeightMedium]
        configurationByApplyingConfiguration:[NSImageSymbolConfiguration configurationWithPaletteColors:@[_picking ? NSColor.whiteColor : NSColor.labelColor]]];
    NSImage *image = [[NSImage imageWithSystemSymbolName:@"eyedropper" accessibilityDescription:@"Pick a colour"] imageWithSymbolConfiguration:config];
    NSSize size = image.size;
    [image drawInRect:NSMakeRect(NSMidX(rect) - size.width / 2, NSMidY(rect) - size.height / 2, size.width, size.height)];
}

- (void)setOffset:(CGFloat)value {
    _offset = MIN(MAX(0, value), self.maxOffset);
    self.needsDisplay = YES;
}

- (void)report:(NSColor *)colour {
    if (_callback) _callback(_context, _itemId.UTF8String, 0, BuretteHexColour(colour).UTF8String);
}

- (void)setHue:(CGFloat)value {
    _hue = MIN(MAX(0, value), 1);
    [self report:self.hueColour];
    self.needsDisplay = YES;
}

- (void)setHueAtX:(CGFloat)x {
    NSRect track = self.hueTrack;
    [self setHue:(x - NSMinX(track)) / NSWidth(track)];
}

- (NSPoint)pointForEvent:(NSEvent *)event {
    return [self convertPoint:event.locationInWindow fromView:nil];
}

- (void)mouseDown:(NSEvent *)event {
    NSPoint p = [self pointForEvent:event];
    if (NSPointInRect(p, NSInsetRect(self.eyedropperRect, -5, -5))) {
        _picking = !_picking;
        if (_picking) {
            _selected = -1;
            [self report:self.hueColour];
        }
        self.needsDisplay = YES;
        return;
    }
    if (!NSPointInRect(p, self.stripRect)) return;
    if (_picking) {
        [self setHueAtX:p.x];
        return;
    }
    _dragging = YES;
    _dragMoved = NO;
    _dragStartX = p.x;
    _dragStartOffset = _offset;
}

- (void)mouseDragged:(NSEvent *)event {
    NSPoint p = [self pointForEvent:event];
    if (_picking) {
        [self setHueAtX:p.x];
        return;
    }
    if (!_dragging) return;
    if (fabs(p.x - _dragStartX) > 3) _dragMoved = YES;
    if (_dragMoved) [self setOffset:_dragStartOffset - (p.x - _dragStartX)];
}

- (void)mouseUp:(NSEvent *)event {
    BOOL click = _dragging && !_dragMoved && !_picking;
    _dragging = NO;
    if (!click) return;
    NSPoint p = [self pointForEvent:event];
    NSInteger index = (NSInteger)floor((p.x - NSMinX(self.stripRect) - 3 + _offset) / BuretteSwatchPitch);
    if (index < 0 || index >= (NSInteger)_swatches.count) return;
    _selected = index;
    [self report:_swatches[index]];
    self.needsDisplay = YES;
}

- (void)scrollWheel:(NSEvent *)event {
    BOOL horizontal = fabs(event.scrollingDeltaX) > fabs(event.scrollingDeltaY);
    CGFloat delta = horizontal ? event.scrollingDeltaX : event.scrollingDeltaY;
    if (!event.hasPreciseScrollingDeltas) delta *= 10;
    if (_picking) {
        [self setHue:_hue - delta / (NSWidth(self.stripRect) * 1.5)];
    } else {
        [self setOffset:_offset - delta];
    }
}

@end

// MARK: - C entry points

NSMenuItem *burette_menu_slider_item(NSString *itemId, NSString *title, NSString *symbol, double value, double min,
                                     double max, double step, NSString *unit, BuretteMenuValueCallback callback,
                                     void *context) {
    NSMenuItem *item = [[NSMenuItem alloc] init];
    item.view = [[BuretteMenuSliderView alloc] initWithId:itemId title:title symbol:symbol value:value min:min max:max
                                                     step:step unit:unit callback:callback context:context];
    return item;
}

NSMenuItem *burette_menu_colour_item(NSString *itemId, NSArray<NSString *> *colours, NSString *active,
                                     BuretteMenuValueCallback callback, void *context) {
    NSMutableArray<NSColor *> *palette = [NSMutableArray array];
    for (NSString *hex in colours) {
        NSColor *colour = BuretteColourFromHex(hex);
        if (colour) [palette addObject:colour];
    }
    NSMenuItem *item = [[NSMenuItem alloc] init];
    item.view = [[BuretteMenuColourView alloc] initWithId:itemId colours:palette active:BuretteColourFromHex(active)
                                                 callback:callback context:context];
    return item;
}

// macOS 27 hides menu item images unless the item opts in. Older SDKs lack the
// property, and older systems always show the image.
void burette_menu_item_show_image(NSMenuItem *item) {
#if defined(__MAC_27_0) && __MAC_OS_X_VERSION_MAX_ALLOWED >= __MAC_27_0
    if (@available(macOS 27.0, *)) {
        item.preferredImageVisibility = NSMenuItemImageVisibilityVisible;
    }
#else
    (void)item;
#endif
}
