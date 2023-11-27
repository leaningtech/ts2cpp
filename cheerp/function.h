#ifndef CHEERP_FUNCTION_H
#define CHEERP_FUNCTION_H
#include "cheerp/types.h"
namespace [[cheerp::genericjs]] client {
	class EventListener;
	template<class F>
	class _Function : public Function {
	public:
		_Function(const EventListener* x): Function(cheerp::identity(x)) {
		}
	};
}
#endif
