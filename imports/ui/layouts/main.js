import { Template } from 'meteor/templating';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import './main.html';

Template.mainLayout.helpers({
  activeIf(routeName) {
    return FlowRouter.getRouteName() === routeName ? 'active' : '';
  },
});
