/*global defineSuite*/
defineSuite([
             'DynamicScene/DynamicEllipse',
             'DynamicScene/ConstantProperty',
             'Core/Color'
            ], function(
                    DynamicEllipse,
              ConstantProperty,
              Color) {
    "use strict";
    /*global jasmine,describe,xdescribe,it,xit,expect,beforeEach,afterEach,beforeAll,afterAll,spyOn,runs,waits,waitsFor*/

    it('merge assigns unassigned properties', function() {
        var source = new DynamicEllipse();
        source.semiMajorAxis = new ConstantProperty(1);
        source.semiMinorAxis = new ConstantProperty(2);
        source.bearing = new ConstantProperty(3);

        var target = new DynamicEllipse();
        target.merge(source);
        expect(target.semiMajorAxis).toBe(source.semiMajorAxis);
        expect(target.semiMinorAxis).toBe(source.semiMinorAxis);
        expect(target.bearing).toBe(source.bearing);
    });

    it('merge does not assign assigned properties', function() {
        var source = new DynamicEllipse();
        source.semiMajorAxis = new ConstantProperty(1);
        source.semiMinorAxis = new ConstantProperty(2);
        source.bearing = new ConstantProperty(3);

        var semiMajorAxis = new ConstantProperty(1);
        var semiMinorAxis = new ConstantProperty(2);
        var bearing = new ConstantProperty(3);

        var target = new DynamicEllipse();
        target.semiMajorAxis = semiMajorAxis;
        target.semiMinorAxis = semiMinorAxis;
        target.bearing = bearing;

        target.merge(source);
        expect(target.semiMajorAxis).toBe(semiMajorAxis);
        expect(target.semiMinorAxis).toBe(semiMinorAxis);
        expect(target.bearing).toBe(bearing);
    });

    it('clone works', function() {
        var source = new DynamicEllipse();
        source.semiMajorAxis = new ConstantProperty(1);
        source.semiMinorAxis = new ConstantProperty(2);
        source.bearing = new ConstantProperty(3);

        var result = source.clone();
        expect(result.semiMajorAxis).toBe(source.semiMajorAxis);
        expect(result.semiMinorAxis).toBe(source.semiMinorAxis);
        expect(result.bearing).toBe(source.bearing);
    });

    it('merge throws if source undefined', function() {
        var target = new DynamicEllipse();
        expect(function() {
            target.merge(undefined);
        }).toThrow();
    });
});