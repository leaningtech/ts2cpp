#ifndef CHEERP_JSHELPER_H
#define CHEERP_JSHELPER_H
#include <type_traits>
namespace [[cheerp::genericjs]] client {
	class Object;
	class [[cheerp::client_layout]] _Any {
	public:
		template<class T>
		T cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		explicit operator double() const {
			return this->cast<double>();
		}
		explicit operator int() const {
			return this->cast<double>();
		}
	};
	template<class... Variants>
	class [[cheerp::client_layout]] _Union {
	public:
		template<class T>
		std::enable_if_t<(std::is_same_v<T, Variants> || ...), T> cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		explicit operator double() const {
			return this->cast<double>();
		}
		explicit operator int() const {
			return this->cast<double>();
		}
	};
	template<class F>
	class _Function;
	template<class T>
	class TArray;
}
namespace cheerp {
	template<class T>
	struct ArrayElementType {
		using type = client::_Any*;
	};
	template<class T>
	struct ArrayElementType<client::TArray<T>> {
		using type = T;
	};
	template<class T>
	using RemoveCvRefT = std::remove_cv_t<std::remove_reference_t<T>>;
	template<class T>
	using ArrayElementTypeT = typename ArrayElementType<RemoveCvRefT<T>>::type;
	template<class From, class To>
	constexpr bool IsAcceptableImplV = std::is_same_v<std::remove_pointer_t<RemoveCvRefT<To>>, client::_Any> || std::is_same_v<std::remove_pointer_t<RemoveCvRefT<From>>, client::_Any> || std::is_convertible_v<From, To> || std::is_convertible_v<From, const std::remove_pointer_t<To>&>;
	template<class From, class To>
	struct IsAcceptable {
		constexpr static bool value = IsAcceptableImplV<From, To>;
	};
	template<class From, template<class...> class To, class... T>
	struct IsAcceptable<From*, To<T...>*> {
		template<class... U>
		[[cheerp::genericjs]]
		constexpr static bool test(To<U...>* x) {
			return IsAcceptable<To<U...>*, To<T...>*>::value;
		}
		[[cheerp::genericjs]]
		constexpr static bool test(void*) {
			return false;
		}
		constexpr static bool value = IsAcceptableImplV<From*, To<T...>*> || test((From*) nullptr);
	};
	template<template<class...> class Class, class... T, class... U>
	struct IsAcceptable<Class<T...>*, Class<U...>*> {
		constexpr static bool value = (IsAcceptable<T, U>::value && ...);
	};
	template<class From, class... To>
	constexpr bool IsAcceptableV = (IsAcceptable<From, To>::value || ...);
	// TODO: Fix cheerp crash when passing parameters to base initializers
	// unmodified so identity is no longer needed
	template<class T>
	[[cheerp::genericjs]]
	T identity(T value) {
		return value;
	}
}
#endif
