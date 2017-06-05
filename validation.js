(function() {
    'use strict';

    // By default validation only starts after calling validation.validate,
    // usually that is done when the form is first submitted.
    // Afterwards elements will be validated as they are changed
    var validationEnabled = false;

    // Would be easy to do with jQuery: elem.is(":visible")
    // Better way to do this in Angular?
    function isVisible(elem) {
        if (elem.hasClass("ng-hide") || elem.css("display") === "none") {
            return false;
        }
        var parent = elem.parent();
        if (parent[0] !== window.document) {
            return isVisible(parent);
        }
        return true;
    }

    // Reset validationMap on route change to prevent memory leak!
    // Also remove forms from the validationMap when scope is destroyed.

    /*
     * When using ngRepeat we can access the validationMap inside custom rules.
     * This allows us to trigger validation on related elements.
     * The validationMap has the structure below.
     * Note that the index level is only set if required, for elements outside an
     * ngRepeat the validateElement function is set on path.
     * Path is the data path specified on ng-model for the element.
     *  {
     *    formIndex: {
     *      rule: {
     *        path: {
     *          index: validateElement
     *        }
     *      }
     *    }
     *  }
     */
    var validationMap = {};
    function registerForm(scope, form) {
        // Register the form by setting the validationRegistered property
        if (!form.validationRegistered) {
            form.validationRegistered = true;

            // Broadcast the "beforeClose" event before scope is destroyed,
            // this event can be used to clean up references.
            scope.$on("beforeClose", function() {
                angular.forEach(validationMap, function(item, key) {
                    var r = new RegExp("^" + form.$name);
                    if (key.match(r)) {
                        delete validationMap[key];
                    }
                });
            });
        }
    }

    angular.module('validation', [
        // Validation module requires angular-ui bootstrap.
        "ui.bootstrap"
    ])
    .run(["$rootScope", function($rootScope) {
        $rootScope.$on("$routeChangeSuccess", function() {
            validationMap = {};
        })
    }]);
    angular.module('validation.directives', []);
    angular.module('validation.services', []);

    // .........................................................................
    angular.module('validation')
    .directive('validationMessage', ['$compile', 'validation', '$parse',
    function($compile, validation, $parse) {
    return function(scope, elem, attrs) {
        // Get the message for this rule
        var params = attrs["validationMessage"].split(" ");
        var formName = params[0];
        var elemName = params[1];
        var rule = params[2];

        // Does the rule exists on the local scope?
        var message = "";
        var getRule = $parse(rule);
        if (getRule(scope)) {
            message = rule + ".message";

        } else {
            // Does the rule exist in the validation service?
            if (validation.rules[rule]) {
                message = "validation.messages." + rule;
            }
        }

        var template = '<span ng-show="formName[\'elemName\'].$error.rule' +
            ' && formName[\'elemName\'].$dirty" ng-bind="message"></span>';
        template = template.replace(/formName/g, formName);
        template = template.replace(/elemName/g, elemName);
        template = template.replace(/rule/g, rule);
        template = template.replace(/message/g, message);
        var validationMessage = $compile(template)(scope);
        elem.after(validationMessage);
        elem.remove();
    }}]);

    // .........................................................................
    angular.module('validation')
    .directive('validate', ['$compile', 'validation', '$parse',
    function($compile, validation, $parse) {
    return {
    require: ["ngModel", "^form"],
    compile: function(elem, attrs) {
        var elemName = elem[0].name;
        var rulesToCheck = attrs["validate"].split(" ");

        // Show validation tooltip by default, requires angular-ui
        // The tooltip attribute must be set to a property on the scope.
        // Name of the property differs between version of UI Bootstrap
        var tooltip = attrs["tooltip"]
            ? attrs["tooltip"] // Older versions
            : attrs["uibTooltip"]; // Newer
        if (tooltip) {
            // Get property name of tooltip message.
            var r = new RegExp("{{([\\w,\\.]*)}}");
            tooltip = tooltip.match(r);
            if (tooltip) {
                tooltip = tooltip[1];
            }
        }

        return function(scope, elem, attrs, required) {
            // Note the difference between ngModel and attrs["ngModel"],
            // the first is the model controller for the current element,
            // the latter is the path of the model value on the parent scope
            var ngModel = required[0]; // model controller
            var path = attrs["ngModel"]; // string
            var form = required[1];
            registerForm(scope, form);
            var formName = form.$name;

            // outerIndex must be set in the template to use the validationMap
            // with multiple levels of nested ngRepeat.
            //
            // To use it set the following on the first ngRepeat:
            //      ng-init="outerIndex = $parent.$index"
            // And use this for subsequent levels of ngRepeat:
            //      ng-init="outerIndex = outerIndex + '.' + $parent.$index"
            //
            var outerIndex = (typeof scope["outerIndex"] !== "undefined")
                ? scope["outerIndex"]
                : undefined;

            // This enables display of a default tooltip if no validation error
            if (tooltip) {
                // Reading scope[tooltip] won't work
                // if tooltip contains a dot
                var tooltipDefault = $parse(tooltip)(scope) || "";
            }

            var setDirty = function() {
                elem.addClass("ng-dirty");
                // Side-effects of creating property manually?
                scope[formName][elemName] = scope[formName][elemName] || {};
            };

            var validateElement = function(stopPropagation) {
                if (!validationEnabled) {
                    // Do not validate until this flag is set
                    return;
                }

                // False if any rule linked to the element fails
                var valid = true;
                // Will be set to the message of the last invalid rule
                var message = "";

                angular.forEach(rulesToCheck, function(rule) {
                    var elemValid = true;
                    if (!isVisible(elem)) {
                        // Do not validate hidden elements.
                        scope[formName][elemName].$setValidity(rule, true);
                        return;
                    }

                    // Note that val could be undefined.
                    // Don't assign a default value to modelValue,
                    // the caller might want to check if it is undefined
                    // in the validation rule
                    var val = ngModel.$modelValue;

                    // Does the rule exist on the local scope?
                    // Use $parse in case the rule name contains a dot
                    var getRule = $parse(rule);
                    if (getRule(scope)) {
                        // TODO Options passed into the validation function,
                        // validation rules should only read from option,
                        // it must not be modified!
                        elemValid = getRule(scope).validate(val, {
                            scope: scope,
                            formName: formName,
                            index: scope.$index,
                            outerIndex: outerIndex,
                            rule: rule,
                            path: path,
                            stopPropagation: stopPropagation,
                            viewValue: ngModel.$viewValue
                        });
                        scope[formName][elemName].$setValidity(rule, elemValid);
                        if (!elemValid) {
                            message = getRule(scope).message;
                        }

                    } else {
                        // Does the rule exist in the validation service?
                        if (validation.rules[rule]) {
                            elemValid = validation.rules[rule].validate(val);
                            scope[formName][elemName].$setValidity(
                                rule, elemValid);
                            if (!elemValid) {
                                message = validation.rules[rule].message;
                            }
                        }
                    }

                    valid = valid && elemValid;
                });

                if (tooltip) {
                    if (valid) {
                        $parse(tooltip).assign(scope, tooltipDefault);
                    } else {
                        if (typeof message === "string") {
                            // Use $parse in case tooltip contains a dot,
                            // The following does not work for that case:
                            //      scope[tooltip] = message;
                            $parse(tooltip).assign(scope, message);
                        }
                    }
                }
            };

            scope.$on("validate", function(event, options) {
                if (formName !== options["targetFormName"]) {
                    return;
                }

                // Do this in case the users never touched the element,
                // if not set as dirty the element won't appear on
                // $scope.formName and element.valid will then error if called.
                // Also, only invalid elements marked as dirty will be styled
                if (!elem.hasClass("ng-dirty")) {
                    setDirty();
                }

                validateElement();
            });

            angular.forEach(rulesToCheck, function(rule) {
                var index = scope.$index;
                var formIndex = (typeof outerIndex !== "undefined")
                    ? formName + outerIndex
                    : formName;
                validationMap[formIndex] = validationMap[formIndex] || {};
                validationMap[formIndex][rule] =
                    validationMap[formIndex][rule] || {};
                if (typeof index !== "undefined") {
                    validationMap[formIndex][rule][path] =
                        validationMap[formIndex][rule][path] || {};
                    validationMap[formIndex][rule][path][index] =
                        validateElement;
                } else {
                    validationMap[formIndex][rule][path] = validateElement;
                }
            });

            scope.$watch(path, function() {
                // This ensures that the user is not distracted with an error
                // until after interacting with the element.
                if (elem.hasClass("ng-dirty")) {
                    validateElement();
                }
            });
        }
    }}}]);

    // .........................................................................
    function validation($rootScope, $timeout) {
        var self = this;

        this.enableValidation = function() {
            validationEnabled = true;
        };

        // Messages can be changed on the fly.
        // This is useful, for example, in a language manager service
        this.messages = {
            number: "Must be a valid number",
            required: "This field is required"
        };
        // Make the validation messages available on the rootScope.
        $rootScope.validation = {};
        $rootScope.validation.messages = self.messages;

        this.rules = {
            number: {
                validate: function(value) {
                    self.rules.number.message = self.messages.number;
                    return !isNaN(Number(value));
                }
            },
            required: {
                validate: function(value) {
                    self.rules.required.message = self.messages.required;
                    if (typeof(value) === "string") {
                        return value.trim().length !== 0;
                    }
                    return typeof(value) !== "undefined";
                }
            }
        };

        /**
         * Given a value check if it matches the specified rule.
         * If no value is specified return the default validation message
         *
         * @param rule
         * @param value
         */
        this.validateRule = function(rule, value) {
            // For two arguments validate the given value.
            if (self.rules[rule]) {
                return self.rules[rule].validate(value);
            } else {
                // Just return false for unknown rule.
                return false;
            }
        };

        /**
         * Get validation failed message for the given rule.
         * @param rule
         * @returns {*}
         */
        this.getMessage = function(rule) {
            if (self.rules[rule]) {
                return self.rules[rule].message;
            } else {
                // Unknown rule return empty message.
                return "";
            }
        };

        // TODO Remove this function?
        this.getMap = function() {
            return validationMap;
        };

        /**
         * This can be called from within a custom validation function,
         * use it to check a related element, e.g. start date and end date.
         *
         * @param {object} options
         * @param {string} options.formName
         * @param {string} options.rule
         * @param {string} options.path
         * @param {number} [options.index] Used with nested forms
         * @param {boolean} [options.stopPropagation]
         */
        this.validateElement = function(options) {
            // Use a timeout so the calling function can return first.
            // http://docs.angularjs.org/api/ng/service/$timeout
            $timeout(function() {
                var fn = validationMap[options.formName];
                if (fn) fn = fn[options.rule];
                if (fn) fn = fn[options.path];
                if (fn && (typeof options.index !== "undefined")) {
                    fn = fn[options.index];
                }
                if (fn) {
                    fn(options.stopPropagation);
                }
            });
        };

        /**
         * This can be called from within a custom validation function,
         * use it to check multiple related elements,
         * e.g. only one element in a group of elements is required
         *
         * @param {object} options
         * @param {string} options.formName
         * @param {string} options.rule
         * @param {string} [options.pathPrefix]
         * @param {array} options.elements
         * @param {number} [options.index] Used with nested forms
         * @param {boolean} [options.stopPropagation]
         */
        this.validateGroup = function(options) {
            if (options.stopPropagation) {
                return;
            }

            options.pathPrefix = options.pathPrefix
                ? options.pathPrefix + "."
                : "";
            angular.forEach(options.elements, function (element) {
                self.validateElement({
                    formName: options.formName,
                    rule: options.rule,
                    path: options.pathPrefix + element,
                    index: options.index,
                    // Assuming the elements all share the custom rule where
                    // this function is called from, avoid the infinite loop
                    // that will be caused by propagating the event
                    stopPropagation: true
                })
            });
        };

        /**
         * @param {object} options As passed into custom validation rule
         * @param {object} groupOptions
         * @param {string} [groupOptions.pathPrefix]
         * @param {array} groupOptions.elements
         */
        this.validateGroupOptions = function(options, groupOptions) {
            return {
                formName: options.formName,
                rule: options.rule,
                pathPrefix: groupOptions.pathPrefix,
                elements: groupOptions.elements,
                index: options.index,
                stopPropagation: options.stopPropagation
            }
        };

        /**
         * Register validation against the given scope.
         * This function can be used for validation rules
         * that are not linked to an element.
         * Do this after the form becomes available on the scope:
         *
         *  validation.setFormRules($scope, "myFormName", function() {
         *      validation.setRule(..., customRule1);
         *      validation.setRule(..., customRule2);
         *      // etc...
         *  });
         *
         * @param scope
         * @param form
         * @param ruleName Must be unique for the given form
         * @param rule Must return a boolean
         */
        this.setRule = function(scope, form, ruleName, rule) {
            registerForm(scope, form); // TODO Must this be called here?
            var formName = form.$name;
            scope.$on("validate", function(event, options) {
                if (formName !== options["targetFormName"]) {
                    return;
                }
                form.$setValidity(ruleName, rule());
            });
        };

        /**
        * Create a run-once watch to execute setRules
        * when scope[formName] becomes available.
        * Make calls to setRule inside setFormRules
        *
        * @param scope
        * @param formName
        * @param setRules
        */
        this.setFormRules = function(scope, formName, setRules) {
            var unwatch = scope.$watch(formName, function() {
                setRules();
                unwatch(); // Execute the watch once only
            });
        };

        /**
        * Test all validation rules for the given scope.
        * After calling this function test scope.formName.$valid
        * @param scope
        * @param [targetFormName] Useful if there is multiple forms on the page
        */
        this.validate = function(scope, targetFormName) {
            targetFormName = targetFormName || undefined;
            self.enableValidation();
            scope.$broadcast("validate", {
                targetFormName: targetFormName
            });
        };
    }

    angular.module('validation').service("validation", ["$rootScope", "$timeout", validation]);
})();
